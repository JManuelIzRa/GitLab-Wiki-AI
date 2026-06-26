"""
Construcción de un grafo de dependencias entre módulos, a partir de imports/requires
reales detectados en el código (no solo agrupación por carpeta como structure_analyzer).

Estrategia: tree-sitter AST para Python, JavaScript y TypeScript — más preciso que regex
porque no captura imports comentados ni strings fuera de contexto import/require.
Fallback a regex para Go y Java donde la sintaxis es simple y unívoca, y como red de
seguridad si el parser tree-sitter no está disponible para algún lenguaje.

El grafo resultante es a nivel de MÓDULO (primer directorio del path), no de archivo
individual — un grafo de cientos de archivos sería ilegible; uno de 5-15 módulos es útil.
"""
from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# --- Regex fallback para Go y Java ---
_IMPORT_PATTERNS_REGEX: dict[str, list[re.Pattern]] = {
    "Go": [re.compile(r'"([\w.\-]+/[\w./\-]+)"')],
    "Java": [re.compile(r"^\s*import\s+(?:static\s+)?([\w]+(?:\.[\w]+)*);", re.MULTILINE)],
}

# Mapping from our language names to tree-sitter language identifiers
_TS_LANGUAGE_MAP: dict[str, str] = {
    "Python": "python",
    "JavaScript": "javascript",
    "TypeScript": "typescript",
}

# Cached parsers — one per tree-sitter language, None if unavailable
_ts_parser_cache: dict[str, object] = {}


def _get_ts_parser(ts_lang_name: str):
    """Returns a cached tree-sitter Parser for ts_lang_name, or None if unavailable."""
    if ts_lang_name in _ts_parser_cache:
        return _ts_parser_cache[ts_lang_name]

    parser = None
    try:
        from tree_sitter import Language, Parser
        if ts_lang_name == "python":
            import tree_sitter_python
            lang = Language(tree_sitter_python.language())
        elif ts_lang_name == "javascript":
            import tree_sitter_javascript
            lang = Language(tree_sitter_javascript.language())
        elif ts_lang_name == "typescript":
            import tree_sitter_typescript
            lang = Language(tree_sitter_typescript.language_typescript())
        else:
            _ts_parser_cache[ts_lang_name] = None
            return None
        parser = Parser(lang)
    except Exception:
        logger.debug("tree-sitter parser unavailable for %s; falling back to regex", ts_lang_name)

    _ts_parser_cache[ts_lang_name] = parser
    return parser


def _extract_python_imports(root_node) -> list[str]:
    """
    Walk a Python AST and return all module names referenced by import/from-import
    statements as dotted strings (e.g. 'app.services.indexer', '.utils', '..helpers').
    Relative imports preserve the leading dots so the resolver can tell them apart.
    """
    results: list[str] = []

    def walk(node):
        if node.type == "import_statement":
            for child in node.children:
                if child.type == "dotted_name":
                    results.append(child.text.decode("utf-8", errors="replace"))
                elif child.type == "aliased_import":
                    for gc in child.children:
                        if gc.type == "dotted_name":
                            results.append(gc.text.decode("utf-8", errors="replace"))
                            break
        elif node.type == "import_from_statement":
            # Take only the first module-identifying child and stop.
            for child in node.children:
                if child.type == "dotted_name":
                    results.append(child.text.decode("utf-8", errors="replace"))
                    break
                elif child.type == "relative_import":
                    dots = ""
                    name = ""
                    for gc in child.children:
                        if gc.type == "import_prefix":
                            dots = gc.text.decode("utf-8", errors="replace")
                        elif gc.type == "dotted_name":
                            name = gc.text.decode("utf-8", errors="replace")
                    results.append(dots + name)
                    break
        for child in node.children:
            walk(child)

    walk(root_node)
    return results


def _extract_js_ts_imports(root_node) -> list[str]:
    """
    Walk a JS/TS AST and return all import source strings found in:
    - ES6 import statements:  import { x } from './foo'
    - CommonJS require calls: const x = require('./foo')
    - Dynamic imports:        import('./foo')
    """
    results: list[str] = []

    def _string_fragment(node) -> str | None:
        for child in node.children:
            if child.type == "string_fragment":
                return child.text.decode("utf-8", errors="replace")
        return None

    def walk(node):
        if node.type == "import_statement":
            for child in node.children:
                if child.type == "string":
                    frag = _string_fragment(child)
                    if frag:
                        results.append(frag)
        elif node.type == "call_expression":
            children = node.children
            if not children:
                pass
            else:
                callee = children[0]
                if callee.type == "identifier" and callee.text == b"require":
                    args = node.child_by_field_name("arguments")
                    if args:
                        for arg in args.children:
                            if arg.type == "string":
                                frag = _string_fragment(arg)
                                if frag:
                                    results.append(frag)
                elif callee.type == "import":
                    # dynamic import(...)
                    args = node.child_by_field_name("arguments")
                    if args:
                        for arg in args.children:
                            if arg.type == "string":
                                frag = _string_fragment(arg)
                                if frag:
                                    results.append(frag)
        for child in node.children:
            walk(child)

    walk(root_node)
    return results


@dataclass
class ModuleEdge:
    source: str
    target: str
    weight: int = 1  # number of import references between these two modules


@dataclass
class DependencyGraph:
    nodes: list[str] = field(default_factory=list)
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
    """First `depth` directory segments of a path."""
    parts = path.split("/")
    if len(parts) <= 1:
        return "."
    return "/".join(parts[:depth]) if len(parts) > depth else "/".join(parts[:-1]) or parts[0]


def _resolve_relative_import(importer_path: str, import_target: str) -> str | None:
    """
    Resolve a JS/TS relative import (e.g. '../utils/foo') to a normalised repo-relative
    path. Returns None if the result escapes the repo root.
    """
    importer_dir = os.path.dirname(importer_path)
    resolved = os.path.normpath(os.path.join(importer_dir, import_target))
    if resolved.startswith(".."):
        return None
    return resolved.replace("\\", "/")


def _resolve_to_known_paths(
    raw_targets: list[str], language: str, file_path: str, known_paths: set[str]
) -> list[str]:
    """
    Map raw import strings (module names or relative paths) to actual file paths that
    exist in the repo, discarding external packages.
    """
    matched: list[str] = []

    for raw in raw_targets:
        if language in ("JavaScript", "TypeScript"):
            if not raw.startswith("."):
                continue  # external npm package
            resolved = _resolve_relative_import(file_path, raw)
            if resolved is None:
                continue
            candidates = [
                resolved, resolved + ".js", resolved + ".ts",
                resolved + ".jsx", resolved + ".tsx",
                resolved + "/index.js", resolved + "/index.ts",
            ]
            hit = next((c for c in candidates if c in known_paths), None)
            if hit:
                matched.append(hit)

        elif language == "Python":
            dotted = raw.lstrip(".")
            if not dotted:
                continue
            components = dotted.split(".")
            hit = None
            for cut in range(len(components), 0, -1):
                base = "/".join(components[:cut])
                for suffix in (".py", "/__init__.py"):
                    if base + suffix in known_paths:
                        hit = base + suffix
                        break
                if hit:
                    break
            if hit:
                matched.append(hit)

        elif language == "Go":
            last_segment = raw.split("/")[-1]
            candidates = [p for p in known_paths if p.split("/")[0] == last_segment]
            matched.extend(candidates[:1])

        elif language == "Java":
            first_component = raw.split(".")[0]
            candidates = [p for p in known_paths if p.split("/")[0] == first_component]
            matched.extend(candidates[:1])

    return matched


def _detect_internal_imports(
    file_path: str, content: str, language: str, known_paths: set[str]
) -> list[str]:
    """
    Returns repo file paths that file_path imports from.
    Uses tree-sitter AST for Python/JS/TS; regex for Go/Java; regex fallback on parse failure.
    """
    raw_targets: list[str] = []
    used_tree_sitter = False

    ts_lang_name = _TS_LANGUAGE_MAP.get(language)
    if ts_lang_name:
        parser = _get_ts_parser(ts_lang_name)
        if parser:
            try:
                tree = parser.parse(content.encode("utf-8", errors="replace"))
                if language == "Python":
                    raw_targets = _extract_python_imports(tree.root_node)
                else:
                    raw_targets = _extract_js_ts_imports(tree.root_node)
                used_tree_sitter = True
            except Exception:
                logger.debug("tree-sitter parse failed for %s; using regex fallback", file_path)

    if not used_tree_sitter:
        for pattern in _IMPORT_PATTERNS_REGEX.get(language, []):
            for m in pattern.finditer(content):
                raw_targets.append(m.group(1))

    return _resolve_to_known_paths(raw_targets, language, file_path, known_paths)


def build_dependency_graph(
    file_contents: dict[str, str], languages_by_path: dict[str, str]
) -> DependencyGraph:
    """
    file_contents: {path: content} of already-fetched code files.
    languages_by_path: {path: language name} (e.g. "Python"), to select the right parser.
    """
    known_paths = set(file_contents.keys())
    depth = _compute_module_depth(known_paths)
    edge_weights: dict[tuple[str, str], int] = {}
    modules_seen: set[str] = set()

    _supported = {"JavaScript", "TypeScript", "Python", "Go", "Java"}

    for path, content in file_contents.items():
        language = languages_by_path.get(path)
        if not language or language not in _supported:
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
