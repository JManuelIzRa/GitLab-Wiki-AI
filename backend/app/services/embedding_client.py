"""
Cliente de embeddings.

Habla contra un servicio propio (EMBEDDING_URL) que respeta el contrato estándar
de OpenAI para embeddings:

    POST {EMBEDDING_URL}
    body: {"input": [...textos...], "model": "..."}
    -> {"data": [{"embedding": [...]}, ...]}

Se usa httpx directo en vez de el SDK de OpenAI porque EMBEDDING_URL puede vivir
en un host/puerto distinto al del LLM de chat (servicio de embeddings dedicado),
así que no comparte cliente con WikiGenerator.
"""
from __future__ import annotations

import httpx

from app.core.config import settings


class EmbeddingError(Exception):
    """Fallo al generar embeddings (servicio caído, respuesta inesperada, etc.)."""


from openai import AsyncOpenAI

from app.core.config import settings


from llama_index.core import Settings as LISettings
from llama_index.embeddings.huggingface import HuggingFaceEmbedding


class EmbeddingClient:
    def __init__(
        self,
        model: HuggingFaceEmbedding | None = None,
    ):
        self._model = model or HuggingFaceEmbedding(
            cache_folder=r"C:\Users\José Manuel\Downloads\tmp\deepwiki-gitlab\backend\models_cache"
        )

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []

        try:
            truncated = [text[:8000] for text in texts]

            return [
                self._model.get_text_embedding(text)
                for text in truncated
            ]

        except Exception as e:
            raise EmbeddingError(
                f"Error generando embeddings con HuggingFace: {e}"
            ) from e

    async def embed_one(self, text: str) -> list[float]:
        embeddings = await self.embed_batch([text])
        return embeddings[0]