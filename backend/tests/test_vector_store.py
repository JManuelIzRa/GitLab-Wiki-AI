"""Tests for VectorStore + code_chunker using Qdrant in-memory mode (no server needed)."""

import sys

sys.path.insert(0, ".")

import pytest

from app.services.code_chunker import chunk_files
from app.services.vector_store import VectorStore

_SAMPLE_FILES = {
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

_FAKE_DIM = 8
_KEYWORDS = ["user", "router", "find", "create", "map", "export", "require", "id"]


def _fake_embed(text: str) -> list[float]:
    text_lower = text.lower()
    return [float(text_lower.count(k)) for k in _KEYWORDS]


async def _make_store(repo_id: int = 999):
    from qdrant_client import AsyncQdrantClient
    from qdrant_client.models import Distance, VectorParams

    store = VectorStore(repository_id=repo_id)
    store._client = AsyncQdrantClient(location=":memory:")
    await store._client.create_collection(
        collection_name=store.collection_name,
        vectors_config=VectorParams(size=_FAKE_DIM, distance=Distance.COSINE),
    )
    return store


@pytest.mark.asyncio
async def test_chunking_produces_expected_count():
    chunks = chunk_files(_SAMPLE_FILES)
    # Both files are short enough to fit in a single chunk each
    assert len(chunks) == 2


@pytest.mark.asyncio
async def test_upsert_and_search():
    chunks = chunk_files(_SAMPLE_FILES)
    store = await _make_store()

    embeddings = [_fake_embed(c.content) for c in chunks]
    await store.upsert_chunks(chunks, embeddings)

    query_vec = _fake_embed("how do I create a user with an id")
    results = await store.search(query_vec, top_k=2)

    assert len(results) == 2
    assert results[0].score >= results[1].score

    await store.close()


@pytest.mark.asyncio
async def test_reupsert_does_not_duplicate():
    chunks = chunk_files(_SAMPLE_FILES)
    store = await _make_store()
    embeddings = [_fake_embed(c.content) for c in chunks]

    await store.upsert_chunks(chunks, embeddings)
    await store.upsert_chunks(chunks, embeddings)  # second upsert of same chunk_ids

    query_vec = _fake_embed("user")
    results = await store.search(query_vec, top_k=10)
    assert len(results) == 2, "re-upsert must not duplicate points"

    await store.close()


@pytest.mark.asyncio
async def test_search_missing_collection_returns_empty():
    from qdrant_client import AsyncQdrantClient

    store = VectorStore(repository_id=12345)
    store._client = AsyncQdrantClient(location=":memory:")
    # Collection for repo 12345 was never created
    results = await store.search(_fake_embed("user"))
    assert results == []
