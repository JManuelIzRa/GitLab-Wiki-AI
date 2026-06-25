"""
Cliente de embeddings local via HuggingFace.

Usa HuggingFaceEmbedding de LlamaIndex para generar embeddings localmente,
sin depender de un servicio externo. El modelo se descarga una vez y se cachea
en disco (configurable via MODELS_CACHE_DIR en .env).
"""
from __future__ import annotations

import asyncio
from pathlib import Path

from llama_index.embeddings.huggingface import HuggingFaceEmbedding

from app.core.config import settings


class EmbeddingError(Exception):
    """Fallo al generar embeddings."""


_shared_client: "EmbeddingClient | None" = None


def get_embedding_client() -> "EmbeddingClient":
    """Returns the process-level singleton, creating it on first call."""
    global _shared_client
    if _shared_client is None:
        _shared_client = EmbeddingClient()
    return _shared_client


class EmbeddingClient:
    def __init__(
        self,
        model: HuggingFaceEmbedding | None = None,
    ):
        self._model = model or HuggingFaceEmbedding(
            cache_folder=settings.models_cache_dir,
        )

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []

        truncated = [text[:8000] for text in texts]
        loop = asyncio.get_event_loop()
        try:
            return await loop.run_in_executor(
                None,
                lambda: [self._model.get_text_embedding(t) for t in truncated],
            )
        except Exception as e:
            raise EmbeddingError(f"Error generando embeddings con HuggingFace: {e}") from e

    async def embed_one(self, text: str) -> list[float]:
        embeddings = await self.embed_batch([text])
        return embeddings[0]