"""Async client for an OpenAI-compatible HTTP embeddings endpoint."""

from __future__ import annotations

from app.core.config import settings


class EmbeddingError(Exception):
    """Raised when embeddings cannot be generated."""


_shared_client: "EmbeddingClient | None" = None


def get_embedding_client() -> "EmbeddingClient":
    global _shared_client
    if _shared_client is None:
        _shared_client = EmbeddingClient()
    return _shared_client


async def close_embedding_client() -> None:
    global _shared_client
    if _shared_client is not None:
        await _shared_client.close()
        _shared_client = None


_embed_model_cache: dict[str, object] = {}


def _get_embed_model(model_name: str, device: str, cache_folder: str):
    """
    Devuelve una instancia cacheada de HuggingFaceEmbedding para este modelo/device,
    creándola si es la primera vez. Evita recargar los pesos del modelo en cada
    EmbeddingClient() nuevo (que se instancia por request en routes.py/indexer.py).
    """
    cache_key = f"{model_name}::{device}"
    if cache_key not in _embed_model_cache:
        try:
            from llama_index.embeddings.huggingface import HuggingFaceEmbedding
        except ImportError as e:
            raise EmbeddingError(
                f"Falta instalar llama-index-embeddings-huggingface (y sentence-transformers). Detalle: {e}"
            ) from e
        try:
            _embed_model_cache[cache_key] = HuggingFaceEmbedding(
                cache_folder=cache_folder,
            )
        except Exception as e:  # noqa: BLE001 - descarga fallida, modelo inválido, falta de espacio, etc.
            raise EmbeddingError(
                f"No se pudo cargar el modelo de embeddings '{model_name}' (device={device}): {e}"
            ) from e
    return _embed_model_cache[cache_key]


class EmbeddingClient:
    def __init__(self, model_name: str | None = None, device: str | None = None, cache_folder: str | None = None):
        # self.model_name = model_name or settings.embedding_model_name
        # self.device = device or settings.embedding_device
        self.cache_folder = cache_folder or settings.embedding_cache_folder
        self.model_name = "default"
        self.device = "default"

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """
        Embebe una lista de textos. El modelo de HuggingFace es síncrono (no async),
        así que esta función sigue siendo `async def` por compatibilidad con el resto
        del código (que la usa con `await`), pero la inferencia en sí corre síncrona
        dentro del event loop. Para los volúmenes de este proyecto (chunks de código
        de un repo, no miles de documentos) esto es aceptable; si se necesitara evitar
        bloquear el event loop con repos muy grandes, se podría envolver en
        `asyncio.to_thread`.
        """
        if not texts:
            return []
        embed_model = _get_embed_model(self.model_name, self.device, self.cache_folder)
        try:
            embeddings = embed_model.get_text_embedding_batch(texts)
        except Exception as e:  # noqa: BLE001
            raise EmbeddingError(f"Fallo generando embeddings con '{self.model_name}': {e}") from e

        if len(embeddings) != len(texts):
            raise EmbeddingError(
                f"El modelo de embeddings devolvió {len(embeddings)} vectores para {len(texts)} textos."
            )
        return embeddings

    async def embed_one(self, text: str) -> list[float]:
        result = await self.embed_batch([text])
        return result[0]
