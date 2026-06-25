"""Valida EmbeddingClient contra el mock server que replica el contrato OpenAI de embeddings."""
import asyncio
import sys
sys.path.insert(0, ".")

from app.services.embedding_client import EmbeddingClient, EmbeddingError


async def main():
    client = EmbeddingClient(url="http://127.0.0.1:9100/embed", model="text-embedding-3-small")

    single = await client.embed_one("create a user")
    print(f"embed_one -> vector de dimensión {len(single)}: {single}")
    assert isinstance(single, list)
    assert all(isinstance(x, float) for x in single)

    batch = await client.embed_batch(["create a user", "find a router", "export module"])
    print(f"\nembed_batch -> {len(batch)} vectores")
    for i, v in enumerate(batch):
        print(f"  [{i}] {v}")
    assert len(batch) == 3

    # Lista vacía -> lista vacía, sin llamar a la red
    empty = await client.embed_batch([])
    assert empty == []
    print("\nembed_batch([]) -> [] sin llamar al servicio: OK")

    # Servicio caído -> debe lanzar EmbeddingError, no una excepción cruda de httpx
    bad_client = EmbeddingClient(url="http://127.0.0.1:9999/embed")
    try:
        await bad_client.embed_one("x")
        print("ERROR: debería haber lanzado EmbeddingError")
        sys.exit(1)
    except EmbeddingError as e:
        print(f"\nServicio caído -> EmbeddingError: OK ({e})")

    print("\n✅ EmbeddingClient funciona correctamente contra el contrato OpenAI de embeddings")


if __name__ == "__main__":
    asyncio.run(main())
