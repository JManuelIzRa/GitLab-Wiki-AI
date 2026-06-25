"""
Análisis estático de la estructura de un repositorio.

No usa IA: solo heurísticas sobre nombres de archivo, extensiones y
manifiestos de dependencias conocidos. Esto le da a la capa de IA
contexto estructurado en vez de tener que "adivinar" todo desde cero,
y permite generar partes del wiki (árbol de módulos, stack tecnológico)
sin gastar tokens.
"""
from __future__ import annotations

import os
from collections import defaultdict
from dataclasses import dataclass, field

EXTENSION_LANGUAGE = {
    ".py": "Python", ".js": "JavaScript", ".jsx": "JavaScript", ".ts": "TypeScript",
    ".tsx": "TypeScript", ".java": "Java", ".kt": "Kotlin", ".go": "Go", ".rs": "Rust",
    ".rb": "Ruby", ".php": "PHP", ".cs": "C#", ".cpp": "C++", ".c": "C", ".h": "C/C++ Header",
    ".swift": "Swift", ".m": "Objective-C", ".scala": "Scala", ".vue": "Vue",
    ".sql": "SQL", ".sh": "Shell", ".yml": "YAML", ".yaml": "YAML", ".json": "JSON",
    ".tf": "Terraform", ".dockerfile": "Docker",
}

DEPENDENCY_MANIFESTS = {
    "package.json": "Node.js / npm",
    "requirements.txt": "Python / pip",
    "pyproject.toml": "Python / poetry-pep621",
    "Pipfile": "Python / pipenv",
    "pom.xml": "Java / Maven",
    "build.gradle": "Java-Kotlin / Gradle",
    "build.gradle.kts": "Kotlin / Gradle",
    "go.mod": "Go modules",
    "Cargo.toml": "Rust / Cargo",
    "Gemfile": "Ruby / Bundler",
    "composer.json": "PHP / Composer",
    "*.csproj": "C# / .NET",
}

IGNORED_DIR_PARTS = {
    "node_modules", ".git", "dist", "build", "vendor", "__pycache__",
    ".venv", "venv", "target", ".idea", ".vscode", "coverage",
}

ENTRYPOINT_HINTS = {
    "main.py", "app.py", "manage.py", "index.js", "server.js", "main.go",
    "main.rs", "Main.java", "App.java", "main.ts", "index.ts", "wsgi.py", "asgi.py",
}


@dataclass
class ModuleInfo:
    """Agrupación lógica de archivos bajo un mismo directorio de primer/segundo nivel."""
    name: str
    path: str
    file_count: int = 0
    languages: set[str] = field(default_factory=set)
    sample_files: list[str] = field(default_factory=list)


@dataclass
class RepoStructure:
    total_files: int
    languages: dict[str, int]                  # lenguaje -> nº de archivos
    dependency_manifests: list[str]              # paths de manifiestos encontrados
    package_managers: list[str]                  # nombres legibles (Node.js/npm, etc.)
    modules: list[ModuleInfo]
    entrypoints: list[str]
    readme_path: str | None
    config_files: list[str]                      # dockerfiles, ci configs, etc.
    all_paths: list[str]


def _is_ignored(path: str) -> bool:
    parts = path.split("/")
    return any(p in IGNORED_DIR_PARTS for p in parts)


def _detect_language(path: str) -> str | None:
    _, ext = os.path.splitext(path)
    return EXTENSION_LANGUAGE.get(ext.lower())


def analyze_structure(file_paths: list[str]) -> RepoStructure:
    """
    Construye un RepoStructure a partir de la lista plana de paths del árbol del repo.
    Pura función, sin I/O — toda la info de red ya se obtuvo antes.
    """
    file_paths = [p for p in file_paths if not _is_ignored(p)]

    languages: dict[str, int] = defaultdict(int)
    dependency_manifests: list[str] = []
    package_managers: set[str] = set()
    entrypoints: list[str] = []
    config_files: list[str] = []
    readme_path: str | None = None
    modules_map: dict[str, ModuleInfo] = {}

    for path in file_paths:
        base = os.path.basename(path)

        lang = _detect_language(path)
        if lang:
            languages[lang] += 1

        if base in DEPENDENCY_MANIFESTS:
            dependency_manifests.append(path)
            package_managers.add(DEPENDENCY_MANIFESTS[base])
        elif base.endswith(".csproj"):
            dependency_manifests.append(path)
            package_managers.add("C# / .NET")

        if base in ENTRYPOINT_HINTS:
            entrypoints.append(path)

        if base.lower() in ("dockerfile", "docker-compose.yml", "docker-compose.yaml") or ".gitlab-ci" in base:
            config_files.append(path)

        if base.lower().startswith("readme") and readme_path is None:
            readme_path = path

        # Agrupar en "módulo" por primer directorio significativo
        parts = path.split("/")
        if len(parts) > 1:
            module_path = parts[0]
            module_name = parts[0]
        else:
            module_path = "."
            module_name = "(raíz)"

        if module_path not in modules_map:
            modules_map[module_path] = ModuleInfo(name=module_name, path=module_path)
        mod = modules_map[module_path]
        mod.file_count += 1
        if lang:
            mod.languages.add(lang)
        if len(mod.sample_files) < 8:
            mod.sample_files.append(path)

    # Ordenar módulos por relevancia (más archivos primero), filtrando ruido de 1 archivo suelto en raíz
    modules = sorted(modules_map.values(), key=lambda m: m.file_count, reverse=True)

    return RepoStructure(
        total_files=len(file_paths),
        languages=dict(sorted(languages.items(), key=lambda kv: kv[1], reverse=True)),
        dependency_manifests=dependency_manifests,
        package_managers=sorted(package_managers),
        modules=modules,
        entrypoints=entrypoints,
        readme_path=readme_path,
        config_files=config_files,
        all_paths=file_paths,
    )
