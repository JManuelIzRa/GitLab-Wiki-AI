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
    ".py": "Python",
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".java": "Java",
    ".kt": "Kotlin",
    ".go": "Go",
    ".rs": "Rust",
    ".rb": "Ruby",
    ".php": "PHP",
    ".cs": "C#",
    ".cpp": "C++",
    ".c": "C",
    ".h": "C/C++ Header",
    ".swift": "Swift",
    ".m": "Objective-C",
    ".scala": "Scala",
    ".vue": "Vue",
    ".sql": "SQL",
    ".sh": "Shell",
    ".yml": "YAML",
    ".yaml": "YAML",
    ".json": "JSON",
    ".tf": "Terraform",
    ".dockerfile": "Docker",
    ".ex": "Elixir",
    ".exs": "Elixir",
    ".elm": "Elm",
    ".clj": "Clojure",
    ".cljs": "ClojureScript",
    ".hs": "Haskell",
    ".ml": "OCaml",
    ".mli": "OCaml",
    ".dart": "Dart",
    ".lua": "Lua",
    ".r": "R",
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
    "mix.exs": "Elixir / Mix",
    "pubspec.yaml": "Dart / Flutter",
    "elm.json": "Elm",
    "stack.yaml": "Haskell / Stack",
    "cabal.project": "Haskell / Cabal",
    "dune-project": "OCaml / Dune",
}

# Workspace / monorepo manifest filenames — their presence at root implies multiple packages.
MONOREPO_WORKSPACE_FILES = {
    "pnpm-workspace.yaml",
    "pnpm-workspace.yml",
    "nx.json",
    "rush.json",
    "lerna.json",
    "turbo.json",
}

IGNORED_DIR_PARTS = {
    "node_modules",
    ".git",
    "dist",
    "build",
    "vendor",
    "__pycache__",
    ".venv",
    "venv",
    "target",
    ".idea",
    ".vscode",
    "coverage",
    ".next",
    ".nuxt",
    ".output",
    "out",
    "tmp",
    ".tmp",
}

ENTRYPOINT_HINTS = {
    # Python
    "main.py",
    "app.py",
    "manage.py",
    "wsgi.py",
    "asgi.py",
    "server.py",
    "run.py",
    # JavaScript / TypeScript
    "index.js",
    "server.js",
    "main.ts",
    "index.ts",
    "src/index.js",
    "src/index.ts",
    "src/main.js",
    "src/main.ts",
    # Go
    "main.go",
    "cmd/main.go",
    # Rust
    "src/main.rs",
    "main.rs",
    # Java / Kotlin
    "Main.java",
    "App.java",
    "Application.java",
    "Main.kt",
    "App.kt",
    "Application.kt",
    # Ruby
    "config.ru",
    "app.rb",
    # PHP
    "index.php",
    "public/index.php",
    # Elixir
    "lib/application.ex",
    # Dart / Flutter
    "lib/main.dart",
    # Generic
    "Makefile",
    "makefile",
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
    languages: dict[str, int]
    dependency_manifests: list[str]
    package_managers: list[str]
    modules: list[ModuleInfo]
    entrypoints: list[str]
    readme_path: str | None
    config_files: list[str]
    all_paths: list[str]
    # Monorepo fields
    is_monorepo: bool = False
    workspace_roots: list[str] | None = None


def _is_ignored(path: str) -> bool:
    parts = path.split("/")
    return any(p in IGNORED_DIR_PARTS for p in parts)


def _detect_language(path: str) -> str | None:
    _, ext = os.path.splitext(path)
    return EXTENSION_LANGUAGE.get(ext.lower())


def _detect_monorepo(file_paths: list[str], package_manifest_paths: list[str]) -> tuple[bool, list[str] | None]:
    """
    Returns (is_monorepo, workspace_roots).

    A repo is considered a monorepo if any of these conditions hold:
    1. A known workspace config file exists at the root.
    2. A root package.json declares a "workspaces" key (we detect by checking multiple
       nested package.json files — we can't read file content at this stage, so we use
       structure as a proxy: 3+ package.json files at different dirs signals a monorepo).
    """
    basenames = {os.path.basename(p): p for p in file_paths}

    # Condition 1: explicit workspace manifest at root or shallow path
    for wf in MONOREPO_WORKSPACE_FILES:
        if wf in basenames:
            # Workspace roots are first-level directories that have their own package manifest
            roots = sorted(
                {p.split("/")[0] for p in package_manifest_paths if "/" in p and p.split("/")[0] not in {".", ""}}
            )
            return True, roots or None

    # Condition 2: multiple package manifests in distinct subdirectories
    manifest_dirs = sorted(
        {
            os.path.dirname(p)
            for p in package_manifest_paths
            if os.path.basename(p) in {"package.json", "pyproject.toml", "go.mod", "Cargo.toml"}
            and os.path.dirname(p) not in {"", "."}
        }
    )
    if len(manifest_dirs) >= 3:
        return True, manifest_dirs[:20]

    return False, None


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

        # Match both full path and basename against entrypoint hints
        if path in ENTRYPOINT_HINTS or base in ENTRYPOINT_HINTS:
            entrypoints.append(path)

        if (
            base.lower()
            in (
                "dockerfile",
                "docker-compose.yml",
                "docker-compose.yaml",
                "docker-compose.override.yml",
                "docker-compose.prod.yml",
            )
            or ".gitlab-ci" in base
            or base in (".travis.yml", "Jenkinsfile", "circle.yml")
            or (base.endswith(".yml") and path.startswith(".github/"))
        ):
            config_files.append(path)

        if base.lower().startswith("readme") and readme_path is None:
            readme_path = path

        # Group into "module" by first significant directory
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

    modules = sorted(modules_map.values(), key=lambda m: m.file_count, reverse=True)

    is_monorepo, workspace_roots = _detect_monorepo(file_paths, dependency_manifests)

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
        is_monorepo=is_monorepo,
        workspace_roots=workspace_roots,
    )
