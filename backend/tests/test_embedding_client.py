import httpx
import pytest

from app.services.embedding_client import EmbeddingClient, EmbeddingError


@pytest.mark.asyncio
async def test_http_embedding_batch_preserves_index_order():
    async def handler(request: httpx.Request) -> httpx.Response:
        body = __import__("json").loads(request.content)
        assert body == {"input": ["one", "two"], "model": "demo-model"}
        return httpx.Response(
            200,
            json={
                "data": [
                    {"index": 1, "embedding": [2.0, 0.0]},
                    {"index": 0, "embedding": [1.0, 0.0]},
                ]
            },
        )

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    client = EmbeddingClient(
        url="https://embeddings.test/v1/embeddings",
        model="demo-model",
        dimensions=2,
        http_client=http,
    )
    assert await client.embed_batch(["one", "two"]) == [[1.0, 0.0], [2.0, 0.0]]
    await http.aclose()


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
