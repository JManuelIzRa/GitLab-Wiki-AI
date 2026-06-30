"""Async embedding client supporting both HTTP (OpenAI-compatible) and local HuggingFace backends."""

from __future__ import annotations

import httpx

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


# ---------------------------------------------------------------------------
# Local HuggingFace backend (provider="local")
# ---------------------------------------------------------------------------
_embed_model_cache: dict[str, "HuggingFaceEmbedding"] = {}  # type: ignore[name-defined]  # noqa: F821


def _get_hf_embed_model(model_name: str, cache_folder: str):
    """Return a cached HuggingFaceEmbedding instance for *model_name*."""
    if model_name not in _embed_model_cache:
        try:
            from llama_index.embeddings.huggingface import HuggingFaceEmbedding
        except ImportError as e:
            raise EmbeddingError(
                "Local embedding requires 'llama-index-embeddings-huggingface' and 'sentence-transformers'. "
                f"Install them or set EMBEDDING_PROVIDER=http. Detail: {e}"
            ) from e
        try:
            _embed_model_cache[model_name] = HuggingFaceEmbedding(
                model_name=model_name,
                cache_folder=cache_folder,
            )
        except Exception as e:
            raise EmbeddingError(f"Could not load HuggingFace embedding model '{model_name}': {e}") from e
    return _embed_model_cache[model_name]


# ---------------------------------------------------------------------------
# EmbeddingClient — dual-backend
# ---------------------------------------------------------------------------
class EmbeddingClient:
    """Embedding client that supports two backends selected via config:

    * ``provider="http"`` (default) — OpenAI-compatible HTTP endpoint.
    * ``provider="local"`` — local HuggingFace model via llama-index.
    """

    def __init__(
        self,
        *,
        provider: str | None = None,
        url: str | None = None,
        model: str | None = None,
        api_key: str | None = None,
        timeout: float | None = None,
        dimensions: int | None = None,
        http_client: httpx.AsyncClient | None = None,
        cache_folder: str | None = None,
    ):
        self._provider = provider or settings.embedding_provider
        self._owns_client = http_client is None

        if self._provider == "local":
            # Local HuggingFace backend — no HTTP client needed
            self._http: httpx.AsyncClient | None = None
            self.cache_folder = cache_folder or settings.embedding_cache_folder
            self.model_name = model or settings.openai_embedding_model
        else:
            # HTTP backend (default)
            self.url = url or settings.embedding_url
            self.model = model or settings.openai_embedding_model
            self.dimensions = dimensions or settings.embedding_dimensions
            headers = {"Content-Type": "application/json"}
            key = api_key if api_key is not None else settings.embedding_api_key
            if key:
                headers["Authorization"] = f"Bearer {key}"
            self._http = http_client or httpx.AsyncClient(
                headers=headers,
                timeout=timeout or settings.embedding_timeout_seconds,
            )

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []

        if self._provider == "local":
            return await self._embed_batch_local(texts)
        return await self._embed_batch_http(texts)

    async def _embed_batch_http(self, texts: list[str]) -> list[list[float]]:
        """OpenAI-compatible HTTP backend."""
        assert self._http is not None, "HTTP client not initialised for provider=http"
        truncated = [text[: settings.embedding_max_input_chars] for text in texts]
        try:
            response = await self._http.post(
                self.url,
                json={"input": truncated, "model": self.model},
            )
            response.raise_for_status()
            payload = response.json()
            rows = sorted(payload["data"], key=lambda row: row.get("index", 0))
            embeddings = [row["embedding"] for row in rows]
            if len(embeddings) != len(texts):
                raise ValueError(f"expected {len(texts)} embeddings, received {len(embeddings)}")
            if any(len(vector) != self.dimensions for vector in embeddings):
                actual = len(embeddings[0]) if embeddings else 0
                raise ValueError(f"embedding dimension mismatch: configured {self.dimensions}, received {actual}")
            return embeddings
        except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
            raise EmbeddingError(f"Embedding service request failed: {exc}") from exc

    async def _embed_batch_local(self, texts: list[str]) -> list[list[float]]:
        """Local HuggingFace backend (sync inference in async wrapper)."""
        embed_model = _get_hf_embed_model(self.model_name, self.cache_folder)
        try:
            embeddings = embed_model.get_text_embedding_batch(texts)
        except Exception as e:
            raise EmbeddingError(f"Local embedding failed with '{self.model_name}': {e}") from e

        if len(embeddings) != len(texts):
            raise EmbeddingError(f"Embedding model returned {len(embeddings)} vectors for {len(texts)} texts.")
        return embeddings

    async def embed_one(self, text: str) -> list[float]:
        result = await self.embed_batch([text])
        return result[0]

    async def close(self) -> None:
        if self._provider != "local" and self._owns_client and self._http is not None:
            await self._http.aclose()
