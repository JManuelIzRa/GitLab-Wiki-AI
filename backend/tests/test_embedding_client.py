import httpx
import pytest

from app.services.embedding_client import EmbeddingClient, EmbeddingError


@pytest.mark.asyncio
async def test_http_embedding_errors_are_wrapped():
    http = httpx.AsyncClient(transport=httpx.MockTransport(lambda _request: httpx.Response(503, text="down")))
    client = EmbeddingClient(url="https://embeddings.test", http_client=http)
    with pytest.raises(EmbeddingError):
        await client.embed_one("hello")
    await http.aclose()


@pytest.mark.asyncio
async def test_empty_embedding_batch_skips_http():
    client = EmbeddingClient(
        http_client=httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _request: pytest.fail("HTTP should not be called"))
        )
    )
    assert await client.embed_batch([]) == []
    await client._http.aclose()
