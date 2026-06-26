"""
Cross-repository semantic search.

Fan-out: embeds the query once, then searches each repo's Qdrant collection in
parallel and merges results ranked by score.
"""
from __future__ import annotations

import asyncio
import logging

from app.services.embedding_client import EmbeddingError, get_embedding_client
from app.services.vector_store import RetrievedChunk, VectorStore

logger = logging.getLogger(__name__)


async def search_across_repos(
    query: str,
    repo_ids: list[int],
    top_k_per_repo: int = 5,
    top_k_total: int = 10,
) -> list[tuple[int, RetrievedChunk]]:
    """Return (repo_id, chunk) pairs sorted by score descending.

    Embeds the query once, then queries each repo's Qdrant collection concurrently.
    Results are merged and the global top_k_total winners are returned.
    """
    if not repo_ids:
        return []

    query_vector = await get_embedding_client().embed_one(query)

    async def _search_one(repo_id: int) -> list[tuple[int, RetrievedChunk]]:
        store = VectorStore(repo_id)
        try:
            chunks = await store.search(query_vector, top_k=top_k_per_repo)
            return [(repo_id, c) for c in chunks]
        except Exception as exc:
            logger.warning("Cross-repo search failed for repo %d: %s", repo_id, exc)
            return []
        finally:
            await store.close()

    results_per_repo = await asyncio.gather(*[_search_one(rid) for rid in repo_ids])

    all_results: list[tuple[int, RetrievedChunk]] = []
    for per_repo in results_per_repo:
        all_results.extend(per_repo)

    all_results.sort(key=lambda x: x[1].score, reverse=True)
    return all_results[:top_k_total]
