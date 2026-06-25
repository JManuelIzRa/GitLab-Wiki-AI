"""
Valida VectorStore + code_chunker usando Qdrant en modo in-memory (qdrant-client soporta
location=":memory:" sin necesitar un servidor real). Esto prueba la lógica real contra un
Qdrant de verdad, sin depender de Docker ni de la red 192.168.0.100 del usuario.
"""
import asyncio
import sys
sys.path.insert(0, ".")

from app.services.code_chunker import chunk_files
from app.services.vector_store import VectorStore

SAMPLE_FILES = {
    "src/api/users.js": (
        "const express = require('express');\n"
        "const router = express.Router();\n"
        "const { findUser, createUser } = require('../utils/userStore');\n\n"
        "router.get('/:id', (req, res) => {\n"
        "  const user = findUser(req.params.id);\n"
        "  res.json(user);\n"
        "});\n\n"
        "router.post('/', (req, res) => {\n"
        "  const user = createUser(req.body);\n"
        "  res.status(201).json(user);\n"
        "});\n\n"
        "module.exports = router;\n"
    ),
    "src/utils/userStore.js": (
        "const users = new Map();\n\n"
        "function findUser(id) {\n"
        "  return users.get(id) || null;\n"
        "}\n\n"
        "function createUser(data) {\n"
        "  const id = String(users.size + 1);\n"
        "  const user = { id, ...data };\n"
        "  users.set(id, user);\n"
        "  return user;\n"
        "}\n\n"
        "module.exports = { findUser, createUser };\n"
    ),
}

# Embeddings falsos de dimensión pequeña (no necesitamos un modelo real para probar
# la mecánica de chunking + upsert + búsqueda de VectorStore).
FAKE_DIM = 8


def fake_embed(text: str) -> list[float]:
    """Embedding determinístico y barato: cuenta ocurrencias de palabras clave."""
    keywords = ["user", "router", "find", "create", "map", "export", "require", "id"]
    text_lower = text.lower()
    return [float(text_lower.count(k)) for k in keywords]


async def main():
    chunks = chunk_files(SAMPLE_FILES)
    print(f"Chunks generados: {len(chunks)}")
    for c in chunks:
        print(f"  - {c.chunk_id} (líneas {c.start_line}-{c.end_line}, {len(c.content)} chars)")
    assert len(chunks) == 2  # ambos archivos son cortos, un chunk cada uno

    # Monkeypatch: forzamos VectorStore a usar Qdrant in-memory en vez de host/port reales.
    from qdrant_client import AsyncQdrantClient
    from qdrant_client.models import Distance, VectorParams

    store = VectorStore(repository_id=999)
    store._client = AsyncQdrantClient(location=":memory:")

    # Recreamos la colección con la dimensión de prueba (no la de settings, que es 1536)
    await store._client.create_collection(
        collection_name=store.collection_name,
        vectors_config=VectorParams(size=FAKE_DIM, distance=Distance.COSINE),
    )

    embeddings = [fake_embed(c.content) for c in chunks]
    await store.upsert_chunks(chunks, embeddings)
    print("\nUpsert OK")

    # Búsqueda: pregunta sobre "crear un usuario" debería acercarse más al chunk de userStore.js
    query_vec = fake_embed("how do I create a user with an id")
    results = await store.search(query_vec, top_k=2)
    print(f"\nResultados de búsqueda ({len(results)}):")
    for r in results:
        print(f"  - {r.file_path} (score={r.score:.3f}) líneas {r.start_line}-{r.end_line}")

    assert len(results) == 2
    assert results[0].score >= results[1].score  # ordenados por relevancia descendente

    # Re-upsert del mismo chunk (mismo chunk_id) debe sobreescribir, no duplicar.
    await store.upsert_chunks(chunks, embeddings)
    results_after_reupsert = await store.search(query_vec, top_k=10)
    assert len(results_after_reupsert) == 2, "el re-upsert no debería duplicar puntos"
    print("\nRe-upsert no duplica puntos: OK")

    # Colección inexistente -> search debe devolver [] en vez de lanzar excepción
    other_store = VectorStore(repository_id=12345)
    other_store._client = store._client  # mismo cliente in-memory, pero colección distinta sin crear
    empty_results = await other_store.search(query_vec)
    assert empty_results == []
    print("Búsqueda en colección inexistente devuelve [] sin lanzar excepción: OK")

    await store.close()
    print("\n✅ VectorStore + code_chunker funcionan correctamente end-to-end (Qdrant in-memory)")


if __name__ == "__main__":
    asyncio.run(main())
