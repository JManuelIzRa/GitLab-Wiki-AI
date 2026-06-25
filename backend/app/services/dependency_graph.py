"""
Construcción de un grafo de dependencias entre módulos, a partir de imports/requires
reales detectados en el código (no solo agrupación por carpeta como structure_analyzer).

Estrategia: regex por lenguaje en vez de un parser AST completo por cada uno — más simple
de mantener, funciona razonablemente bien para los casos comunes (import relativo o de
paquete interno) y es lo único viable sin añadir un parser por lenguaje al proyecto.
Los imports a paquetes externos (de node_modules, pip, etc.) se descartan: solo nos
interesan las dependencias INTERNAS entre módulos del propio repo, que es lo que tiene
valor visualizar.

El grafo resultante es a nivel de MÓDULO (primer directorio del path), no de archivo
individual — un grafo de cientos de archivos sería ilegible; uno de 5-15 módulos es útil.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field

# Patrones de import por lenguaje. Cada patrón captura el "destino" del import como grupo 1.
# Deliberadamente simples: priorizan no fallar sobre cubrir el 100% de la sintaxis del lenguaje.
IMPORT_PATTERNS: dict[str, list[re.Pattern]] = {
    "JavaScript": [
        re.compile(r"""require\(\s*['"](\.{1,2}/[^'"]+)['"]\s*\)"""),
        re.compile(r"""from\s+['"](\.{1,2}/[^'"]+)['"]"""),
        re.compile(r"""import\(\s*['"](\.{1,2}/[^'"]+)['"]\s*\)"""),
    ],
    "TypeScript": [
        re.compile(r"""from\s+['"](\.{1,2}/[^'"]+)['"]"""),
        re.compile(r"""import\(\s*['"](\.{1,2}/[^'"]+)['"]\s*\)"""),
    ],
    "Python": [
        re.compile(r"^\s*from\s+(\.{1,2}[\w.]*)\s+import", re.MULTILINE),
        re.compile(r"^\s*from\s+([\w]+(?:\.[\w]+)*)\s+import", re.MULTILINE),
        re.compile(r"^\s*import\s+([\w]+(?:\.[\w]+)*)", re.MULTILINE),
    ],
    "Go": [
        re.compile(r'"([\w.\-]+/[\w./\-]+)"'),
    ],
    "Java": [
        re.compile(r"^\s*import\s+(?:static\s+)?([\w]+(?:\.[\w]+)*);", re.MULTILINE),
    ],
}


@dataclass
class ModuleEdge:
    source: str
    target: str
    weight: int = 1  # nº de imports detectados entre estos dos módulos (más imports = línea más gruesa)


@dataclass
class DependencyGraph:
    nodes: list[str] = field(default_factory=list)   # nombres de módulo (primer directorio)
    edges: list[ModuleEdge] = field(default_factory=list)


def _compute_module_depth(known_paths: set[str]) -> int:
    """
    Decide cuántos segmentos de directorio usar para agrupar en "módulo".

    Si casi todos los archivos comparten el mismo primer directorio (típico de un
    paquete Python único, ej. todo bajo `app/`), agrupar solo por ese primer nivel
    produce un grafo de un solo nodo, que no aporta nada. En ese caso usamos 2 niveles
    en vez de 1 (ej. `app/services` en vez de solo `app`).
    """
    first_segments = {p.split("/")[0] for p in known_paths if "/" in p}
    if len(first_segments) <= 1 and first_segments:
        return 2
    return 1


def _module_of(path: str, depth: int = 1) -> str:
    """Primeros `depth` directorios significativos del path."""
    parts = path.split("/")
    if len(parts) <= 1:
        return "."
    return "/".join(parts[:depth]) if len(parts) > depth else "/".join(parts[:-1]) or parts[0]


def _resolve_relative_import(importer_path: str, import_target: str) -> str | None:
    """
    Resuelve un import relativo de JS/TS (ej. '../utils/foo') a un path normalizado
    dentro del repo, para poder saber a qué módulo apunta. Devuelve None si no se
    puede resolver razonablemente (ej. apunta fuera del repo).
    """
    importer_dir = os.path.dirname(importer_path)
    resolved = os.path.normpath(os.path.join(importer_dir, import_target))
    if resolved.startswith(".."):
        return None
    return resolved.replace("\\", "/")


def _detect_internal_imports(file_path: str, content: str, language: str,
                              known_paths: set[str]) -> list[str]:
    """
    Devuelve la lista de paths del repo (no de módulo todavía) a los que `file_path`
    importa, filtrando cualquier cosa que no se pueda resolver a un archivo conocido
    del propio repo (es decir, descarta dependencias externas).
    """
    patterns = IMPORT_PATTERNS.get(language, [])
    targets: list[str] = []

    for pattern in patterns:
        for match in pattern.finditer(content):
            raw_target = match.group(1)

            if language in ("JavaScript", "TypeScript"):
                resolved = _resolve_relative_import(file_path, raw_target)
                if resolved is None:
                    continue
                candidates = [
                    resolved, resolved + ".js", resolved + ".ts", resolved + ".jsx", resolved + ".tsx",
                    resolved + "/index.js", resolved + "/index.ts",
                ]
                match_found = next((c for c in candidates if c in known_paths), None)
                if match_found:
                    targets.append(match_found)

            elif language == "Python":
                dotted = raw_target.lstrip(".")
                if not dotted:
                    continue
                # Convertimos el dotted path completo a una ruta candidata real
                # (ej. 'app.services.indexer' -> 'app/services/indexer.py'), y vamos
                # recortando componentes desde el final hasta encontrar un archivo conocido
                # del repo. Esto resuelve tanto 'from app.services.indexer import X'
                # (módulo exacto) como 'from app.services import X' (paquete/__init__).
                components = dotted.split(".")
                match_found = None
                for cut in range(len(components), 0, -1):
                    candidate_base = "/".join(components[:cut])
                    candidates = [candidate_base + ".py", candidate_base + "/__init__.py"]
                    match_found = next((c for c in candidates if c in known_paths), None)
                    if match_found:
                        break
                if match_found:
                    targets.append(match_found)

            elif language == "Go":
                last_segment = raw_target.split("/")[-1]
                candidate_paths = [p for p in known_paths if p.split("/")[0] == last_segment]
                targets.extend(candidate_paths[:1])

            elif language == "Java":
                first_component = raw_target.split(".")[0]
                candidate_paths = [p for p in known_paths if p.split("/")[0] == first_component]
                targets.extend(candidate_paths[:1])

    return targets


def build_dependency_graph(file_contents: dict[str, str], languages_by_path: dict[str, str]) -> DependencyGraph:
    """
    file_contents: {path: contenido} de los archivos de código ya leídos.
    languages_by_path: {path: nombre de lenguaje} (ej. "JavaScript"), para saber qué
    patrones de import aplicar a cada archivo.
    """
    known_paths = set(file_contents.keys())
    depth = _compute_module_depth(known_paths)
    edge_weights: dict[tuple[str, str], int] = {}
    modules_seen: set[str] = set()

    for path, content in file_contents.items():
        language = languages_by_path.get(path)
        if not language or language not in IMPORT_PATTERNS:
            continue

        source_module = _module_of(path, depth)
        modules_seen.add(source_module)

        targets = _detect_internal_imports(path, content, language, known_paths)
        for target_path in targets:
            target_module = _module_of(target_path, depth)
            if target_module == source_module:
                continue
            modules_seen.add(target_module)
            key = (source_module, target_module)
            edge_weights[key] = edge_weights.get(key, 0) + 1

    edges = [ModuleEdge(source=s, target=t, weight=w) for (s, t), w in edge_weights.items()]
    edges.sort(key=lambda e: e.weight, reverse=True)

    return DependencyGraph(nodes=sorted(modules_seen), edges=edges)
