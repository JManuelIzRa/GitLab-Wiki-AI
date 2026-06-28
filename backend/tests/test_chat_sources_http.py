"""
Valida el endpoint HTTP /api/repositories/{id}/chat con RAG exitoso end-to-end,
usando TestClient (síncrono, sobre la app real) y parcheando VectorStore para que
use Qdrant en modo in-memory pre-poblado, en vez de la red real 192.168.0.100.

Esto confirma que el contrato HTTP que consume AskPanel.jsx (campo `sources` con
file_path/start_line/end_line/content/score) es exactamente lo que el backend real
devuelve a través de FastAPI, no solo a nivel de función Python aislada.
"""

import asyncio
import sys

sys.path.insert(0, ".")

from unittest.mock import patch

from fastapi.testclient import TestClient
from qdrant_client import AsyncQdrantClient
from qdrant_client.models import Distance, VectorParams

from app.core.config import settings
from app.db.session import AsyncSessionLocal, engine, init_db
from app.models.db_models import Base, Repository, WikiPage
from app.services.code_chunker import chunk_files
from app.services.vector_store import VectorStore

SAMPLE_FILES = {
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

FAKE_DIM = 8


def fake_embed(text: str) -> list[float]:
    keywords = ["user", "router", "find", "create", "map", "export", "require", "id"]
    text_lower = text.lower()
    return [float(text_lower.count(k)) for k in keywords]


async def setup_repo_with_qdrant_data():
    """Crea un Repository+WikiPages en SQLite y puebla una colección Qdrant in-memory para él."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await init_db()

    async with AsyncSessionLocal() as session:
        repo = Repository(
            gitlab_url="http://127.0.0.1:9000",
            project_path="demo-group/demo-project",
            project_id="42",
            name="demo-project",
            default_branch="main",
            indexed_in_qdrant=True,
        )
        session.add(repo)
        await session.commit()
        await session.refresh(repo)

        session.add(
            WikiPage(
                repository_id=repo.id,
                slug="overview",
                title="Overview",
                order=0,
                content_markdown="## Resumen\nProyecto demo en Node.js/Express.",
            )
        )
        await session.commit()
        repo_id = repo.id

    shared_memory_client = AsyncQdrantClient(location=":memory:")
    collection_name = f"{settings.qdrant_collection_prefix}{repo_id}"
    await shared_memory_client.create_collection(
        collection_name=collection_name,
        vectors_config=VectorParams(size=FAKE_DIM, distance=Distance.COSINE),
    )

    chunks = chunk_files(SAMPLE_FILES)
    embeddings = [fake_embed(c.content) for c in chunks]
    store = VectorStore(repository_id=repo_id)
    store._client = shared_memory_client
    await store.upsert_chunks(chunks, embeddings)

    return repo_id, shared_memory_client


def main():
    repo_id, shared_memory_client = asyncio.run(setup_repo_with_qdrant_data())

    original_init = VectorStore.__init__

    def patched_init(self, repository_id):
        original_init(self, repository_id)
        self._client = shared_memory_client

    async def patched_embed_one(self, text):
        return fake_embed(text)

    with (
        patch.object(VectorStore, "__init__", patched_init),
        patch("app.services.embedding_client.EmbeddingClient.embed_one", new=patched_embed_one),
        patch("app.services.vector_store.VectorStore.close", new=lambda self: asyncio.sleep(0)),
    ):
        from app.main import app

        client = TestClient(app)

        resp = client.post(f"/api/repositories/{repo_id}/chat", json={"question": "create a user with an id"})
        body = resp.json()

        assert resp.status_code == 200
        assert "sources" in body, "el contrato HTTP debe incluir el campo 'sources'"
        assert len(body["sources"]) > 0, "debe haber al menos un chunk de código recuperado"

        source = body["sources"][0]
        assert set(["file_path", "start_line", "end_line", "content", "score"]).issubset(source.keys()), (
            f"el shape de cada source debe incluir file_path/start_line/end_line/content/score, recibido: {source.keys()}"
        )
        assert source["file_path"] == "src/utils/userStore.js"
        assert "createUser" in source["content"], (
            "el contenido del extracto debe ser código real, no solo el nombre del archivo"
        )
        assert isinstance(source["start_line"], int) and isinstance(source["end_line"], int)
        assert isinstance(source["score"], float)


if __name__ == "__main__":
    main()
