"""
Wiki content generation and chat answers via an OpenAI-compatible LLM endpoint.

Generation strategy:
1. "Overview" page  – README + structure summary + dependency manifests.
2. "Architecture"   – module list + entrypoints + file tree.
3. One page per top-N module: real file samples (budget-capped).
4. "Setup guide"    – dependency manifests + CI/Docker configs + README.

For free-form repo questions (answer_question_rag / stream_answer_question_rag),
RAG is used: the caller supplies code chunks retrieved from Qdrant, and this
module only builds the final prompt and calls the LLM.

Language support: set WIKI_LANGUAGE in config (ISO code, e.g. "es", "en").
Full ES and EN prompt sets are defined below; other codes get EN prompts with
the target language injected into the system instruction.
"""
from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from typing import AsyncGenerator

import httpx
import openai
from openai import AsyncOpenAI

from app.core.config import settings
from app.services.structure_analyzer import RepoStructure, ModuleInfo
from app.services.vector_store import RetrievedChunk

logger = logging.getLogger(__name__)

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


def _get_prompts(language: str) -> dict[str, str]:
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


@dataclass
class FileSnippet:
    path: str
    content: str


def _sanitize_mermaid_blocks(content: str) -> str:
    """Post-process LLM output to fix the most common Mermaid syntax errors in generated blocks."""
    def _fix(m: re.Match) -> str:
        code = m.group(1)
        # Strip any nested backtick fences the LLM accidentally inserts
        code = re.sub(r"```+\w*", "", code)
        # Normalize line endings
        code = code.replace("\r\n", "\n").replace("\r", "\n")
        # Decode common HTML entities that break the Mermaid parser
        code = (code
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", '"')
                .replace("&#39;", "'"))
        return f"```mermaid\n{code.strip()}\n```"

    return re.sub(r"```mermaid\n(.*?)```", _fix, content, flags=re.DOTALL)


def _truncate(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n... [truncated] ..."


def _budget_snippets(snippets: list[FileSnippet], max_chars: int) -> str:
    parts = []
    remaining = max_chars
    for s in snippets:
        if remaining <= 0:
            break
        chunk = _truncate(s.content, min(remaining, 8000))
        parts.append(f"### File: `{s.path}`\n```\n{chunk}\n```")
        remaining -= len(chunk)
    return "\n\n".join(parts)


def _format_retrieved_chunks(chunks: list[RetrievedChunk]) -> str:
    if not chunks:
        return "(no relevant code snippets found)"
    parts = []
    for c in chunks:
        parts.append(
            f"### `{c.file_path}` (lines {c.start_line}-{c.end_line}, score {c.score:.2f})\n"
            f"```\n{c.content}\n```"
        )
    return "\n\n".join(parts)


class WikiGenerator:
    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
        language: str | None = None,
        prompt_overrides: dict | None = None,
    ):
        self._client = AsyncOpenAI(
            base_url=base_url or settings.openai_url,
            api_key=api_key or settings.openai_api_key,
            timeout=httpx.Timeout(60.0),
        )
        self.model = model or settings.openai_chat_model
        effective_lang = language or settings.wiki_language
        base_prompts = _get_prompts(effective_lang)
        if prompt_overrides:
            self._p = {**base_prompts, **{k: v for k, v in prompt_overrides.items() if v}}
        else:
            self._p = base_prompts

    async def close(self) -> None:
        await self._client.close()

    # ------------------------------------------------------------------
    # Core LLM call with exponential-backoff retry
    # ------------------------------------------------------------------

    async def _ask(
        self,
        user_prompt: str,
        system_prompt: str | None = None,
        max_tokens: int | None = None,
        system_prompt_override: str | None = None,
        history: list[dict] | None = None,
    ) -> str:
        effective_system = system_prompt_override or (system_prompt if system_prompt is not None else self._p["system"])

        # Hard budget: trim user_prompt so system + user fit within max_chars_per_ai_call.
        # Individual snippet-level truncation already runs upstream; this is the final safety net.
        system_chars = len(effective_system)
        user_budget = max(500, settings.max_chars_per_ai_call - system_chars)
        if len(user_prompt) > user_budget:
            logger.warning(
                "User prompt (%d chars) exceeds budget (%d); truncating before LLM call.",
                len(user_prompt), user_budget,
            )
            user_prompt = user_prompt[:user_budget] + "\n... [truncated] ..."

        messages: list[dict] = [{"role": "system", "content": effective_system}]
        if history:
            messages.extend({"role": m["role"], "content": m["content"]} for m in history)
        messages.append({"role": "user", "content": user_prompt})

        _retryable = (openai.APIConnectionError, openai.APITimeoutError, openai.InternalServerError)
        last_exc: Exception | None = None
        for attempt in range(4):
            try:
                response = await self._client.chat.completions.create(
                    model=self.model,
                    max_completion_tokens=max_tokens or settings.max_chat_tokens,
                    messages=messages,
                )
                usage = response.usage
                if usage:
                    logger.debug(
                        "LLM token usage: prompt=%d completion=%d total=%d",
                        usage.prompt_tokens, usage.completion_tokens, usage.total_tokens,
                    )
                return response.choices[0].message.content or ""
            except openai.RateLimitError as exc:
                last_exc = exc
                wait = 2 ** (attempt + 2)
                logger.warning("LLM rate limited (attempt %d/4) — retrying in %ds", attempt + 1, wait)
                await asyncio.sleep(wait)
            except _retryable as exc:
                last_exc = exc
                wait = 2 ** attempt
                logger.warning("LLM request failed (attempt %d/4): %s — retrying in %ds", attempt + 1, exc, wait)
                await asyncio.sleep(wait)
        raise last_exc  # type: ignore[misc]

    # ------------------------------------------------------------------
    # Wiki page generators
    # ------------------------------------------------------------------

    async def generate_overview(
        self, project_name: str, structure: RepoStructure, readme_content: str | None,
        system_prompt_override: str | None = None,
    ) -> str:
        lang_summary = ", ".join(f"{lang} ({count} files)" for lang, count in list(structure.languages.items())[:8])
        prompt = self._p["overview"].format(
            project_name=project_name,
            total_files=structure.total_files,
            lang_summary=lang_summary or "undetermined",
            package_managers=", ".join(structure.package_managers) or "none detected",
            dependency_manifests=", ".join(structure.dependency_manifests) or "none",
            readme=_truncate(readme_content or "(no README found)", settings.max_chars_per_ai_call),
        )
        return _sanitize_mermaid_blocks(await self._ask(prompt, system_prompt_override=system_prompt_override))

    async def generate_architecture(
        self, project_name: str, structure: RepoStructure,
        system_prompt_override: str | None = None,
    ) -> str:
        modules_desc = "\n".join(
            f"- `{m.path}` ({m.file_count} files, languages: {', '.join(m.languages) or 'n/a'}). "
            f"Examples: {', '.join(m.sample_files[:5])}"
            for m in structure.modules[:25]
        )
        entrypoints = ", ".join(structure.entrypoints) or "no obvious entry points detected"
        prompt = self._p["architecture"].format(
            project_name=project_name,
            modules_desc=modules_desc,
            entrypoints=entrypoints,
            config_files=", ".join(structure.config_files) or "none",
        )
        return _sanitize_mermaid_blocks(await self._ask(prompt, system_prompt_override=system_prompt_override))

    async def generate_module_page(
        self, project_name: str, module: ModuleInfo, snippets: list[FileSnippet],
        system_prompt_override: str | None = None,
    ) -> str:
        files_context = _budget_snippets(snippets, settings.max_chars_per_ai_call)
        prompt = self._p["module"].format(
            project_name=project_name,
            module_path=module.path,
            file_count=module.file_count,
            languages=", ".join(module.languages) or "n/a",
            files_context=files_context,
        )
        return _sanitize_mermaid_blocks(await self._ask(prompt, system_prompt_override=system_prompt_override))

    async def generate_setup_guide(
        self,
        project_name: str,
        structure: RepoStructure,
        manifest_contents: list[FileSnippet],
        readme_content: str | None,
        system_prompt_override: str | None = None,
    ) -> str:
        manifests_context = _budget_snippets(manifest_contents, settings.max_chars_per_ai_call)
        prompt = self._p["setup"].format(
            project_name=project_name,
            package_managers=", ".join(structure.package_managers) or "none detected",
            config_files=", ".join(structure.config_files) or "none",
            manifests_context=manifests_context or "(no readable manifests found)",
            readme=_truncate(readme_content or "(no README)", 4000),
        )
        return _sanitize_mermaid_blocks(await self._ask(prompt, system_prompt_override=system_prompt_override))

    # ------------------------------------------------------------------
    # RAG chat — non-streaming and streaming variants
    # ------------------------------------------------------------------

    def _build_rag_prompt(
        self,
        project_name: str,
        question: str,
        retrieved_chunks: list[RetrievedChunk],
        wiki_summary: str = "",
    ) -> str:
        code_context = _format_retrieved_chunks(retrieved_chunks)
        wiki_block = (
            f"--- WIKI SUMMARY ---\n{_truncate(wiki_summary, 3000)}\n--- END WIKI SUMMARY ---\n\n"
            if wiki_summary else ""
        )
        return self._p["rag_context"].format(
            project_name=project_name,
            wiki_block=wiki_block,
            code_context=_truncate(code_context, settings.max_chars_per_ai_call),
            question=question,
        )

    async def answer_question_rag(
        self,
        project_name: str,
        question: str,
        retrieved_chunks: list[RetrievedChunk],
        wiki_summary: str = "",
        history: list[dict] | None = None,
    ) -> str:
        prompt = self._build_rag_prompt(project_name, question, retrieved_chunks, wiki_summary)
        return await self._ask(prompt, system_prompt=self._p["chat_system"], history=history)

    async def stream_answer_question_rag(
        self,
        project_name: str,
        question: str,
        retrieved_chunks: list[RetrievedChunk],
        wiki_summary: str = "",
        history: list[dict] | None = None,
    ) -> AsyncGenerator[str, None]:
        """Stream answer tokens as they arrive from the LLM. Retries connection (not mid-stream)."""
        prompt = self._build_rag_prompt(project_name, question, retrieved_chunks, wiki_summary)
        messages: list[dict] = [{"role": "system", "content": self._p["chat_system"]}]
        if history:
            messages.extend({"role": m["role"], "content": m["content"]} for m in history)
        messages.append({"role": "user", "content": prompt})

        _retryable = (openai.APIConnectionError, openai.APITimeoutError, openai.InternalServerError)
        stream = None
        last_exc: Exception | None = None
        for attempt in range(3):
            try:
                stream = await self._client.chat.completions.create(
                    model=self.model,
                    max_completion_tokens=settings.max_chat_tokens,
                    messages=messages,
                    stream=True,
                )
                break
            except _retryable as exc:
                last_exc = exc
                if attempt < 2:
                    wait = 2 ** attempt
                    logger.warning("Streaming connection failed (attempt %d/3): %s — retrying in %ds",
                                   attempt + 1, exc, wait)
                    await asyncio.sleep(wait)
        if stream is None:
            raise last_exc  # type: ignore[misc]

        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta

    # ------------------------------------------------------------------
    # Group-level generation
    # ------------------------------------------------------------------

    async def generate_group_overview(
        self,
        group_name: str,
        repo_summaries: list[dict],
    ) -> str:
        """Generate a high-level overview wiki page for a GitLab group.

        Each entry in repo_summaries should have: name, path, pages (list of {title, content}).
        """
        summaries_text = ""
        for rs in repo_summaries:
            pages_text = "\n".join(
                f"  - **{p['title']}**: {p['content'][:200].strip()}"
                for p in rs.get("pages", [])[:4]
            )
            summaries_text += (
                f"### {rs['name']} (`{rs['path']}`)\n{pages_text or '(no wiki pages yet)'}\n\n"
            )

        prompt = self._p.get("group_overview", _PROMPTS["en"]["group_overview"]).format(
            group_name=group_name,
            repo_count=len(repo_summaries),
            repo_summaries=summaries_text or "(no repos with generated wikis yet)",
        )
        return _sanitize_mermaid_blocks(await self._ask(prompt, max_tokens=settings.max_chat_tokens))

    async def answer_group_question_rag(
        self,
        group_name: str,
        repo_names: list[str],
        question: str,
        retrieved_chunks: list[RetrievedChunk],
        group_wiki_summary: str = "",
    ) -> str:
        code_context = _format_retrieved_chunks(retrieved_chunks)
        wiki_block = (
            f"--- GROUP WIKI SUMMARY ---\n{_truncate(group_wiki_summary, 2000)}\n--- END ---\n\n"
            if group_wiki_summary else ""
        )
        template = self._p.get("group_chat_context", _PROMPTS["en"]["group_chat_context"])
        prompt = template.format(
            group_name=group_name,
            repo_list=", ".join(repo_names) or "(none)",
            wiki_block=wiki_block,
            code_context=_truncate(code_context, settings.max_chars_per_ai_call),
            question=question,
        )
        return await self._ask(prompt, system_prompt=self._p["chat_system"])

    async def stream_answer_group_question_rag(
        self,
        group_name: str,
        repo_names: list[str],
        question: str,
        retrieved_chunks: list[RetrievedChunk],
        group_wiki_summary: str = "",
    ) -> AsyncGenerator[str, None]:
        code_context = _format_retrieved_chunks(retrieved_chunks)
        wiki_block = (
            f"--- GROUP WIKI SUMMARY ---\n{_truncate(group_wiki_summary, 2000)}\n--- END ---\n\n"
            if group_wiki_summary else ""
        )
        template = self._p.get("group_chat_context", _PROMPTS["en"]["group_chat_context"])
        prompt = template.format(
            group_name=group_name,
            repo_list=", ".join(repo_names) or "(none)",
            wiki_block=wiki_block,
            code_context=_truncate(code_context, settings.max_chars_per_ai_call),
            question=question,
        )
        messages = [
            {"role": "system", "content": self._p["chat_system"]},
            {"role": "user", "content": prompt},
        ]
        _retryable = (openai.APIConnectionError, openai.APITimeoutError, openai.InternalServerError)
        stream = None
        last_exc: Exception | None = None
        for attempt in range(3):
            try:
                stream = await self._client.chat.completions.create(
                    model=self.model,
                    max_completion_tokens=settings.max_chat_tokens,
                    messages=messages,
                    stream=True,
                )
                break
            except _retryable as exc:
                last_exc = exc
                if attempt < 2:
                    await asyncio.sleep(2 ** attempt)
        if stream is None:
            raise last_exc  # type: ignore[misc]
        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta
