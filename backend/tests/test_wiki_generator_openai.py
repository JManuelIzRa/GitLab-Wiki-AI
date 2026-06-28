"""Valida WikiGenerator usando AsyncOpenAI contra el mock del servidor LLM local."""

import asyncio
import sys

sys.path.insert(0, ".")

from app.services.vector_store import RetrievedChunk
from app.services.wiki_generator import WikiGenerator


async def main():
    generator = WikiGenerator(base_url="http://127.0.0.1:9200/v1", model="qwen2.5-3b-instruct-q4_k_m.gguf")

    # _ask básico
    answer = await generator._ask("Genera la página Overview del proyecto demo")
    assert "Resumen" in answer

    # answer_question_rag con chunks recuperados simulados
    fake_chunks = [
        RetrievedChunk(
            file_path="src/utils/userStore.js",
            start_line=1,
            end_line=15,
            content="function createUser(data) { ... }",
            score=0.91,
        ),
        RetrievedChunk(
            file_path="src/api/users.js",
            start_line=1,
            end_line=16,
            content="router.post('/', ...)",
            score=0.78,
        ),
    ]
    rag_answer = await generator.answer_question_rag(
        project_name="demo-project",
        question="¿dónde se guardan los usuarios en memoria?",
        retrieved_chunks=fake_chunks,
        wiki_summary="## Overview\nProyecto demo en Node/Express.",
    )
    assert "userStore" in rag_answer or "Map" in rag_answer

    # answer_question_rag sin chunks (Qdrant no disponible) -> no debe lanzar excepción,
    # y el prompt enviado debe indicar explícitamente que no hay fragmentos relevantes
    # (verificamos esto inspeccionando _format_retrieved_chunks directamente, ya que el
    # mock siempre devuelve la misma respuesta fija para cualquier prompt con ese marcador).
    from app.services.wiki_generator import _format_retrieved_chunks

    empty_context = _format_retrieved_chunks([])
    assert "no se encontraron fragmentos" in empty_context.lower()

    rag_answer_no_chunks = await generator.answer_question_rag(
        project_name="demo-project",
        question="¿qué hace este proyecto?",
        retrieved_chunks=[],
        wiki_summary="## Overview\nProyecto demo.",
    )
    assert rag_answer_no_chunks  # no vacío, generó algo (el mock siempre responde algo no vacío)


if __name__ == "__main__":
    asyncio.run(main())
