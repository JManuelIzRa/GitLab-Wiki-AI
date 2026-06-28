"""
Valida el endpoint HTTP /api/repositories/{id}/search (búsqueda semántica directa, sin LLM)
usando TestClient sobre la app real, con Qdrant in-memory pre-poblado.
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
from app.models.db_models import Base, Repository
from app.services.code_chunker import chunk_files
from app.services.vector_store import VectorStore

SAMPLE_FILES = {
    "src/api/users.js": (
        "const express = require('express');\n"
        "const router = express.Router();\n"
        "router.get('/:id', (req, res) => { res.json(findUser(req.params.id)); });\n"
        "module.exports = router;\n"
    ),
    "src/utils/userStore.js": (
        "const users = new Map();\n"
        "function createUser(data) {\n"
        "  const id = String(users.size + 1);\n"
        "  users.set(id, { id, ...data });\n"
        "  return users.get(id);\n"
        "}\n"
        "module.exports = { createUser };\n"
    ),
}
FAKE_DIM = 8


def fake_embed(text: str) -> list[float]:
    keywords = ["user", "router", "find", "create", "map", "export", "require", "id"]
    text_lower = text.lower()
    return [float(text_lower.count(k)) for k in keywords]


async def setup():
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
        repo_id = repo.id

    shared_client = AsyncQdrantClient(location=":memory:")
    collection_name = f"{settings.qdrant_collection_prefix}{repo_id}"
    await shared_client.create_collection(
        collection_name=collection_name,
        vectors_config=VectorParams(size=FAKE_DIM, distance=Distance.COSINE),
    )
    chunks = chunk_files(SAMPLE_FILES)
    embeddings = [fake_embed(c.content) for c in chunks]
    store = VectorStore(repository_id=repo_id)
    store._client = shared_client
    await store.upsert_chunks(chunks, embeddings)

    # repo sin Qdrant indexado, para probar el caso 400
    async with AsyncSessionLocal() as session:
        repo2 = Repository(
            gitlab_url="http://127.0.0.1:9000",
            project_path="otro/repo",
            project_id="99",
            name="otro-repo",
            default_branch="main",
            indexed_in_qdrant=False,
        )
        session.add(repo2)
        await session.commit()
        await session.refresh(repo2)
        repo2_id = repo2.id

    return repo_id, repo2_id, shared_client


def main():
    repo_id, repo2_id, shared_client = asyncio.run(setup())

    original_init = VectorStore.__init__

    def patched_init(self, repository_id):
        original_init(self, repository_id)
        self._client = shared_client

    async def patched_embed_one(self, text):
        return fake_embed(text)

    with (
        patch.object(VectorStore, "__init__", patched_init),
        patch("app.services.embedding_client.EmbeddingClient.embed_one", new=patched_embed_one),
        patch("app.services.vector_store.VectorStore.close", new=lambda self: asyncio.sleep(0)),
    ):
        from app.main import app

        client = TestClient(app)

        # Caso 1: búsqueda exitosa
        resp = client.post(f"/api/repositories/{repo_id}/search", json={"query": "create a user with an id"})
        body = resp.json()
        for r in body["results"]:
            pass

        assert resp.status_code == 200
        assert len(body["results"]) == 2
        assert body["results"][0]["score"] >= body["results"][1]["score"]
        assert "content" in body["results"][0]
        assert body["results"][0]["content"]  # no vacío

        # Caso 2: top_k limita los resultados
        resp_topk = client.post(f"/api/repositories/{repo_id}/search", json={"query": "create user", "top_k": 1})
        assert len(resp_topk.json()["results"]) == 1

        # Caso 3: repo sin Qdrant indexado -> 400 explicativo
        resp_400 = client.post(f"/api/repositories/{repo2_id}/search", json={"query": "x"})
        assert resp_400.status_code == 400

        # Caso 4: repo inexistente -> 404
        resp_404 = client.post("/api/repositories/9999/search", json={"query": "x"})
        assert resp_404.status_code == 404


if __name__ == "__main__":
    main()
