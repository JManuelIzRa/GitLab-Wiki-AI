"""
Generación de contenido del wiki y respuestas de chat, usando un LLM servido vía un
endpoint OpenAI-compatible local (ej. llama.cpp / vLLM / LM Studio sirviendo
qwen2.5-3b-instruct-q4_k_m.gguf en OPENAI_URL).

Estrategia de generación del wiki:
1. Página "Overview": usa el README (si existe) + resumen de estructura + manifiestos de dependencias.
2. Página "Arquitectura": usa la lista de módulos + entrypoints + árbol de archivos.
3. Una página por cada módulo principal (top N por nº de archivos): usa una muestra de archivos
   de ese módulo (contenido real, recortado a un presupuesto de caracteres) para que la IA
   explique qué hace, no solo liste archivos.
4. Página "Cómo ejecutar el proyecto": usa manifiestos de dependencias + configs (Docker, CI) + README.

Como el modelo configurado es un modelo local pequeño (3B cuantizado), los prompts se
mantienen deliberadamente acotados (ver max_chars_per_ai_call en config.py) — un modelo
de este tamaño degrada mucho con contextos largos, a diferencia de modelos grandes en la nube.

Para preguntas libres sobre el repo (answer_question), en vez de pasar todo el wiki se usa
RAG: el caller (routes.py) ya trae los chunks de código más relevantes recuperados de Qdrant
y este módulo solo se encarga de construir el prompt y llamar al LLM.
"""
from __future__ import annotations

from dataclasses import dataclass

import httpx
from openai import AsyncOpenAI

from app.core.config import settings
from app.services.structure_analyzer import RepoStructure, ModuleInfo
from app.services.vector_store import RetrievedChunk

SYSTEM_PROMPT = """Eres un ingeniero de software senior que escribe documentación técnica clara y precisa \
para un wiki interno de un repositorio de código (estilo DeepWiki).

Reglas:
- Responde SIEMPRE en español, en formato Markdown limpio (sin envolver todo en bloques de código).
- Usa encabezados (##, ###), listas y bloques de código con el lenguaje correcto cuando muestres código.
- Si necesitas representar un flujo o arquitectura, usa un bloque ```mermaid``` con un diagrama válido \
(flowchart, sequenceDiagram o classDiagram).
- Basa tus afirmaciones únicamente en el código y archivos proporcionados. Si algo no es evidente \
en el contexto dado, dilo explícitamente en vez de inventarlo.
- Sé concreto: nombra archivos, funciones y rutas reales que aparezcan en el contexto.
- No incluyas un título h1 al inicio (el título de la página ya se muestra aparte); empieza directo \
con el contenido."""

CHAT_SYSTEM_PROMPT = """Eres un asistente que responde preguntas sobre un repositorio de código específico. \
Tienes acceso a fragmentos reales de código recuperados por búsqueda semántica y al wiki ya generado \
del proyecto. Responde SIEMPRE en español, de forma directa y concisa, en Markdown.

Reglas:
- Basa tu respuesta únicamente en el contexto proporcionado (fragmentos de código + wiki).
- Si el contexto no contiene la respuesta, dilo explícitamente en vez de inventar.
- Si citas código, indica de qué archivo proviene.
- No repitas el contexto completo, sintetiza la respuesta."""


@dataclass
class FileSnippet:
    path: str
    content: str


def _truncate(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n... [contenido truncado] ..."


def _budget_snippets(snippets: list[FileSnippet], max_chars: int) -> str:
    """Concatena snippets de archivo respetando un presupuesto total de caracteres."""
    parts = []
    remaining = max_chars
    for s in snippets:
        if remaining <= 0:
            break
        chunk = _truncate(s.content, min(remaining, 8000))
        parts.append(f"### Archivo: `{s.path}`\n```\n{chunk}\n```")
        remaining -= len(chunk)
    return "\n\n".join(parts)


def _format_retrieved_chunks(chunks: list[RetrievedChunk]) -> str:
    """Formatea los chunks de código recuperados de Qdrant para insertarlos en un prompt."""
    if not chunks:
        return "(no se encontraron fragmentos de código relevantes)"
    parts = []
    for c in chunks:
        parts.append(
            f"### `{c.file_path}` (líneas {c.start_line}-{c.end_line}, relevancia {c.score:.2f})\n"
            f"```\n{c.content}\n```"
        )
    return "\n\n".join(parts)


class WikiGenerator:
    def __init__(self, base_url: str | None = None, api_key: str | None = None, model: str | None = None):
        self._client = AsyncOpenAI(
            base_url=base_url or settings.openai_url,
            api_key=api_key or settings.openai_api_key,
            timeout=httpx.Timeout(60.0),
        )
        self.model = model or settings.openai_chat_model

    async def close(self) -> None:
        await self._client.close()

    async def _ask(self, user_prompt: str, system_prompt: str = SYSTEM_PROMPT, max_tokens: int | None = None) -> str:
        response = await self._client.chat.completions.create(
            model=self.model,
            max_completion_tokens=max_tokens or settings.max_chat_tokens,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        return response.choices[0].message.content or ""

    async def generate_overview(
        self, project_name: str, structure: RepoStructure, readme_content: str | None
    ) -> str:
        lang_summary = ", ".join(f"{lang} ({count} archivos)" for lang, count in list(structure.languages.items())[:8])
        prompt = f"""Genera la página "Overview" del wiki para el proyecto `{project_name}`.

Contexto estructural:
- Total de archivos indexados: {structure.total_files}
- Lenguajes detectados: {lang_summary or "no determinado"}
- Gestores de dependencias detectados: {", ".join(structure.package_managers) or "ninguno detectado"}
- Manifiestos de dependencias: {", ".join(structure.dependency_manifests) or "ninguno"}

README del proyecto (puede estar vacío o ausente):
{_truncate(readme_content or "(no se encontró README)", settings.max_chars_per_ai_call)}

Escribe una página de overview que explique: qué es el proyecto, su propósito principal, \
el stack tecnológico, y una visión general de alto nivel de cómo está organizado. \
Incluye una sección "## Stack tecnológico" con el lenguaje/framework detectado."""
        return await self._ask(prompt)

    async def generate_architecture(self, project_name: str, structure: RepoStructure) -> str:
        modules_desc = "\n".join(
            f"- `{m.path}` ({m.file_count} archivos, lenguajes: {', '.join(m.languages) or 'n/a'}). "
            f"Ejemplos: {', '.join(m.sample_files[:5])}"
            for m in structure.modules[:25]
        )
        entrypoints = ", ".join(structure.entrypoints) or "no se detectaron puntos de entrada obvios"
        prompt = f"""Genera la página "Arquitectura" del wiki para el proyecto `{project_name}`.

Módulos/directorios principales detectados (por heurística de carpetas):
{modules_desc}

Puntos de entrada probables: {entrypoints}

Archivos de configuración detectados (CI/CD, contenedores): {", ".join(structure.config_files) or "ninguno"}

Escribe una página de arquitectura que explique cómo se relacionan estos módulos entre sí, \
cuál parece ser el flujo principal de la aplicación, y dónde está cada responsabilidad \
(ej. API, lógica de negocio, acceso a datos, frontend, infraestructura). \
Incluye un diagrama ```mermaid``` tipo flowchart que represente la arquitectura de alto nivel \
inferida de estos módulos."""
        return await self._ask(prompt)

    async def generate_module_page(
        self, project_name: str, module: ModuleInfo, snippets: list[FileSnippet]
    ) -> str:
        files_context = _budget_snippets(snippets, settings.max_chars_per_ai_call)
        prompt = f"""Genera la página de wiki para el módulo `{module.path}` del proyecto `{project_name}`.

Este módulo contiene {module.file_count} archivos en total. Lenguajes: {', '.join(module.languages) or 'n/a'}.

A continuación el contenido real de una muestra representativa de archivos de este módulo:

{files_context}

Explica: el propósito de este módulo dentro del proyecto, sus componentes/archivos clave y qué hace cada uno, \
y cómo se conecta probablemente con el resto del sistema. Si ves funciones o clases relevantes, \
nómbralas explícitamente y explica su rol."""
        return await self._ask(prompt)

    async def generate_setup_guide(
        self,
        project_name: str,
        structure: RepoStructure,
        manifest_contents: list[FileSnippet],
        readme_content: str | None,
    ) -> str:
        manifests_context = _budget_snippets(manifest_contents, settings.max_chars_per_ai_call)
        prompt = f"""Genera la página "Cómo ejecutar el proyecto" del wiki para `{project_name}`.

Gestores de dependencias detectados: {", ".join(structure.package_managers) or "ninguno detectado"}
Archivos de configuración (Docker/CI): {", ".join(structure.config_files) or "ninguno"}

Contenido de los manifiestos de dependencias encontrados:
{manifests_context or "(no se encontraron manifiestos legibles)"}

Fragmento del README (si menciona instalación o ejecución):
{_truncate(readme_content or "(sin README)", 4000)}

Escribe una guía práctica de instalación y ejecución local: requisitos previos, pasos de instalación \
de dependencias, comandos para ejecutar el proyecto y, si es detectable, cómo correr pruebas. \
Si la información disponible no permite saber algo con certeza, indícalo en vez de inventar comandos."""
        return await self._ask(prompt)

    async def answer_question_rag(
        self,
        project_name: str,
        question: str,
        retrieved_chunks: list[RetrievedChunk],
        wiki_summary: str = "",
    ) -> str:
        """
        Responde una pregunta usando RAG real: el caller ya recuperó los chunks de código
        más relevantes de Qdrant (por similitud semántica con la pregunta) y opcionalmente
        un resumen breve del wiki ya generado. Este método solo construye el prompt final.
        """
        code_context = _format_retrieved_chunks(retrieved_chunks)
        wiki_block = (
            f"--- RESUMEN DEL WIKI ---\n{_truncate(wiki_summary, 3000)}\n--- FIN RESUMEN ---\n"
            if wiki_summary else ""
        )
        prompt = f"""Proyecto: `{project_name}`

{wiki_block}--- FRAGMENTOS DE CÓDIGO RELEVANTES (recuperados por búsqueda semántica) ---
{_truncate(code_context, settings.max_chars_per_ai_call)}
--- FIN FRAGMENTOS ---

Pregunta del usuario: {question}"""
        return await self._ask(prompt, system_prompt=CHAT_SYSTEM_PROMPT)
