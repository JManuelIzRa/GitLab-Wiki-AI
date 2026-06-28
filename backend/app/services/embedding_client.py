"""Async client for an OpenAI-compatible HTTP embeddings endpoint."""

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


class EmbeddingClient:
    def __init__(
        self,
        url: str | None = None,
        model: str | None = None,
        api_key: str | None = None,
        timeout: float | None = None,
        dimensions: int | None = None,
        http_client: httpx.AsyncClient | None = None,
    ):
        self.url = url or settings.embedding_url
        self.model = model or settings.openai_embedding_model
        self.dimensions = dimensions or settings.embedding_dimensions
        headers = {"Content-Type": "application/json"}
        key = api_key if api_key is not None else settings.embedding_api_key
        if key:
            headers["Authorization"] = f"Bearer {key}"
        self._owns_client = http_client is None
        self._http = http_client or httpx.AsyncClient(
            headers=headers,
            timeout=timeout or settings.embedding_timeout_seconds,
        )

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
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

    async def embed_one(self, text: str) -> list[float]:
        return (await self.embed_batch([text]))[0]

    async def close(self) -> None:
        if self._owns_client:
            await self._http.aclose()
