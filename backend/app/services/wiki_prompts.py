"""Language-specific prompt catalogs used by the wiki generator."""

# ---------------------------------------------------------------------------
# Prompt sets keyed by ISO language code.
# Each entry is a dict with keys: system, chat_system, overview, architecture,
# module, setup, rag_context (template for the RAG user prompt).
# ---------------------------------------------------------------------------

_PROMPTS: dict[str, dict[str, str]] = {
    "es": {
        "system": (
            "Eres un ingeniero de software senior que escribe documentación técnica clara y precisa "
            "para un wiki interno de un repositorio de código (estilo DeepWiki).\n\n"
            "Reglas:\n"
            "- Responde SIEMPRE en español, en formato Markdown limpio (sin envolver todo en bloques de código).\n"
            "- Usa encabezados (##, ###), listas y bloques de código con el lenguaje correcto cuando muestres código.\n"
            "- Si necesitas representar un flujo o arquitectura, usa un bloque ```mermaid``` con un diagrama válido "
            "(flowchart, sequenceDiagram o classDiagram). Reglas de sintaxis Mermaid obligatorias:\n"
            "  · Los IDs de nodo solo admiten letras, dígitos y guiones bajos — nunca espacios, puntos, barras ni paréntesis.\n"
            "  · Las etiquetas con espacios o caracteres especiales DEBEN ir entre comillas dobles: A[\"Mi Módulo\"].\n"
            "  · Nunca uses () en el ID de un nodo — Mermaid los interpreta como formas de estadio.\n"
            "  · Máximo 14 nodos por diagrama. Usa subgraph para agrupar capas (frontend, backend, db…).\n"
            "  · Prefiere flowchart TD para arquitecturas jerárquicas y flowchart LR para pipelines lineales.\n"
            "  · No anides bloques de código dentro del bloque mermaid.\n"
            "- Basa tus afirmaciones únicamente en el código y archivos proporcionados. Si algo no es evidente "
            "en el contexto dado, dilo explícitamente en vez de inventarlo.\n"
            "- Sé concreto: nombra archivos, funciones y rutas reales que aparezcan en el contexto.\n"
            "- No incluyas un título h1 al inicio (el título de la página ya se muestra aparte); empieza directo "
            "con el contenido."
        ),
        "chat_system": (
            "Eres un asistente que responde preguntas sobre un repositorio de código específico. "
            "Tienes acceso a fragmentos reales de código recuperados por búsqueda semántica y al wiki ya generado "
            "del proyecto. Responde SIEMPRE en español, de forma directa y concisa, en Markdown.\n\n"
            "Reglas:\n"
            "- Basa tu respuesta únicamente en el contexto proporcionado (fragmentos de código + wiki).\n"
            "- Si el contexto no contiene la respuesta, dilo explícitamente en vez de inventar.\n"
            "- Si citas código, indica de qué archivo proviene.\n"
            "- No repitas el contexto completo, sintetiza la respuesta."
        ),
        "overview": (
            "Genera la página \"Overview\" del wiki para el proyecto `{project_name}`.\n\n"
            "Contexto estructural:\n"
            "- Total de archivos indexados: {total_files}\n"
            "- Lenguajes detectados: {lang_summary}\n"
            "- Gestores de dependencias detectados: {package_managers}\n"
            "- Manifiestos de dependencias: {dependency_manifests}\n\n"
            "README del proyecto (puede estar vacío o ausente):\n"
            "{readme}\n\n"
            "Escribe una página de overview que explique: qué es el proyecto, su propósito principal, "
            "el stack tecnológico, y una visión general de alto nivel de cómo está organizado. "
            "Incluye una sección \"## Stack tecnológico\" con el lenguaje/framework detectado."
        ),
        "architecture": (
            "Genera la página \"Arquitectura\" del wiki para el proyecto `{project_name}`.\n\n"
            "Módulos/directorios principales detectados (por heurística de carpetas):\n"
            "{modules_desc}\n\n"
            "Puntos de entrada probables: {entrypoints}\n\n"
            "Archivos de configuración detectados (CI/CD, contenedores): {config_files}\n\n"
            "Escribe una página de arquitectura que explique cómo se relacionan estos módulos entre sí, "
            "cuál parece ser el flujo principal de la aplicación, y dónde está cada responsabilidad "
            "(ej. API, lógica de negocio, acceso a datos, frontend, infraestructura). "
            "Incluye un diagrama ```mermaid``` tipo flowchart TD que represente la arquitectura de alto nivel. "
            "Usa subgraph para agrupar módulos por capa (p.ej. subgraph Frontend, subgraph Backend). "
            "Nodos con etiquetas entre comillas dobles, IDs solo alfanuméricos, máximo 14 nodos."
        ),
        "module": (
            "Genera la página de wiki para el módulo `{module_path}` del proyecto `{project_name}`.\n\n"
            "Este módulo contiene {file_count} archivos en total. Lenguajes: {languages}.\n\n"
            "A continuación el contenido real de una muestra representativa de archivos de este módulo:\n\n"
            "{files_context}\n\n"
            "Explica: el propósito de este módulo dentro del proyecto, sus componentes/archivos clave y qué hace cada uno, "
            "y cómo se conecta probablemente con el resto del sistema. Si ves funciones o clases relevantes, "
            "nómbralas explícitamente y explica su rol."
        ),
        "setup": (
            "Genera la página \"Cómo ejecutar el proyecto\" del wiki para `{project_name}`.\n\n"
            "Gestores de dependencias detectados: {package_managers}\n"
            "Archivos de configuración (Docker/CI): {config_files}\n\n"
            "Contenido de los manifiestos de dependencias encontrados:\n"
            "{manifests_context}\n\n"
            "Fragmento del README (si menciona instalación o ejecución):\n"
            "{readme}\n\n"
            "Escribe una guía práctica de instalación y ejecución local: requisitos previos, pasos de instalación "
            "de dependencias, comandos para ejecutar el proyecto y, si es detectable, cómo correr pruebas. "
            "Si la información disponible no permite saber algo con certeza, indícalo en vez de inventar comandos."
        ),
        "rag_context": (
            "Proyecto: `{project_name}`\n\n"
            "{wiki_block}"
            "--- FRAGMENTOS DE CÓDIGO RELEVANTES (recuperados por búsqueda semántica) ---\n"
            "{code_context}\n"
            "--- FIN FRAGMENTOS ---\n\n"
            "Pregunta del usuario: {question}"
        ),
        "group_overview": (
            "Genera la página \"Overview del Grupo\" para el grupo GitLab `{group_name}`.\n\n"
            "El grupo contiene {repo_count} repositorios. A continuación un resumen de cada uno:\n\n"
            "{repo_summaries}\n\n"
            "Escribe una página de overview del grupo que explique: el propósito general del grupo, "
            "los repositorios clave y qué hace cada uno, el stack tecnológico predominante, "
            "y cómo se interrelacionan los repositorios entre sí (si es deducible). "
            "Incluye una tabla con los repositorios y sus lenguajes principales. "
            "Incluye un diagrama ```mermaid``` que muestre cómo se relacionan los repositorios a alto nivel."
        ),
        "group_chat_context": (
            "Grupo GitLab: `{group_name}`\n\n"
            "Repositorios en el grupo: {repo_list}\n\n"
            "{wiki_block}"
            "--- FRAGMENTOS DE CÓDIGO RELEVANTES (de múltiples repos) ---\n"
            "{code_context}\n"
            "--- FIN FRAGMENTOS ---\n\n"
            "Pregunta del usuario: {question}"
        ),
    },
    "en": {
        "system": (
            "You are a senior software engineer writing clear and precise technical documentation "
            "for an internal code repository wiki (DeepWiki style).\n\n"
            "Rules:\n"
            "- Always respond in English, in clean Markdown format (do not wrap everything in code blocks).\n"
            "- Use headings (##, ###), lists, and code blocks with the correct language when showing code.\n"
            "- If you need to represent a flow or architecture, use a ```mermaid``` block with a valid diagram "
            "(flowchart, sequenceDiagram, or classDiagram). Mandatory Mermaid syntax rules:\n"
            "  · Node IDs must use only letters, digits, and underscores — no spaces, dots, slashes, hyphens, or parentheses.\n"
            "  · Labels with spaces or special characters MUST be quoted: A[\"My Module\"].\n"
            "  · Never use () in a node ID — Mermaid interprets them as stadium shapes.\n"
            "  · Keep diagrams concise: maximum 14 nodes. Use subgraph to group layers (frontend, backend, db…).\n"
            "  · Prefer flowchart TD for hierarchical architectures and flowchart LR for linear pipelines.\n"
            "  · Do not nest code fences inside the mermaid block.\n"
            "- Base your statements only on the code and files provided. If something is not evident in the "
            "given context, say so explicitly instead of making it up.\n"
            "- Be concrete: name real files, functions, and paths that appear in the context.\n"
            "- Do not include an h1 heading at the start (the page title is displayed separately); "
            "start directly with the content."
        ),
        "chat_system": (
            "You are an assistant answering questions about a specific code repository. "
            "You have access to real code snippets retrieved by semantic search and the already-generated "
            "project wiki. Always respond in English, concisely and directly, in Markdown.\n\n"
            "Rules:\n"
            "- Base your answer only on the provided context (code snippets + wiki).\n"
            "- If the context does not contain the answer, say so explicitly instead of making it up.\n"
            "- If you quote code, mention which file it comes from.\n"
            "- Do not repeat the full context; synthesize the answer."
        ),
        "overview": (
            "Generate the \"Overview\" wiki page for project `{project_name}`.\n\n"
            "Structural context:\n"
            "- Total indexed files: {total_files}\n"
            "- Detected languages: {lang_summary}\n"
            "- Detected package managers: {package_managers}\n"
            "- Dependency manifests: {dependency_manifests}\n\n"
            "Project README (may be empty or absent):\n"
            "{readme}\n\n"
            "Write an overview page explaining: what the project is, its main purpose, "
            "the technology stack, and a high-level view of how it is organized. "
            "Include a \"## Tech Stack\" section with the detected language/framework."
        ),
        "architecture": (
            "Generate the \"Architecture\" wiki page for project `{project_name}`.\n\n"
            "Main modules/directories detected (by folder heuristic):\n"
            "{modules_desc}\n\n"
            "Likely entry points: {entrypoints}\n\n"
            "Detected configuration files (CI/CD, containers): {config_files}\n\n"
            "Write an architecture page explaining how these modules relate to each other, "
            "what the main application flow appears to be, and where each responsibility lives "
            "(e.g. API, business logic, data access, frontend, infrastructure). "
            "Include a ```mermaid``` flowchart TD diagram representing the high-level architecture. "
            "Use subgraph to group modules by layer (e.g. subgraph Frontend, subgraph Backend). "
            "Node labels in double quotes, IDs alphanumeric only, maximum 14 nodes."
        ),
        "module": (
            "Generate the wiki page for module `{module_path}` of project `{project_name}`.\n\n"
            "This module contains {file_count} files in total. Languages: {languages}.\n\n"
            "Below is the actual content of a representative sample of files from this module:\n\n"
            "{files_context}\n\n"
            "Explain: the purpose of this module within the project, its key components/files and what each does, "
            "and how it likely connects with the rest of the system. If you see relevant functions or classes, "
            "name them explicitly and explain their role."
        ),
        "setup": (
            "Generate the \"How to run the project\" wiki page for `{project_name}`.\n\n"
            "Detected package managers: {package_managers}\n"
            "Configuration files (Docker/CI): {config_files}\n\n"
            "Contents of detected dependency manifests:\n"
            "{manifests_context}\n\n"
            "README excerpt (if it mentions installation or running):\n"
            "{readme}\n\n"
            "Write a practical local installation and execution guide: prerequisites, dependency installation "
            "steps, commands to run the project, and if detectable, how to run tests. "
            "If the available information does not allow certainty about something, say so instead of inventing commands."
        ),
        "rag_context": (
            "Project: `{project_name}`\n\n"
            "{wiki_block}"
            "--- RELEVANT CODE SNIPPETS (retrieved by semantic search) ---\n"
            "{code_context}\n"
            "--- END SNIPPETS ---\n\n"
            "User question: {question}"
        ),
        "group_overview": (
            "Generate the \"Group Overview\" page for GitLab group `{group_name}`.\n\n"
            "The group contains {repo_count} repositories. Below is a summary of each:\n\n"
            "{repo_summaries}\n\n"
            "Write a group overview page explaining: the group's overall purpose, "
            "the key repositories and what each does, the predominant technology stack, "
            "and how the repositories interrelate (if inferable). "
            "Include a table listing repositories with their primary languages. "
            "Include a ```mermaid``` diagram showing how the repositories relate at a high level."
        ),
        "group_chat_context": (
            "GitLab Group: `{group_name}`\n\n"
            "Repositories in group: {repo_list}\n\n"
            "{wiki_block}"
            "--- RELEVANT CODE SNIPPETS (from multiple repos) ---\n"
            "{code_context}\n"
            "--- END SNIPPETS ---\n\n"
            "User question: {question}"
        ),
    },
}


def get_prompts(language: str) -> dict[str, str]:
    """Return the prompt set for the given ISO language code, falling back to English."""
    lang = language.lower()
    if lang in _PROMPTS:
        return _PROMPTS[lang]
    # Unknown language: use English prompts but override the language instruction.
    lang_name = lang.capitalize()
    prompts = dict(_PROMPTS["en"])
    prompts["system"] = prompts["system"].replace(
        "Always respond in English", f"Always respond in {lang_name}"
    )
    prompts["chat_system"] = prompts["chat_system"].replace(
        "Always respond in English", f"Always respond in {lang_name}"
    )
    return prompts


