"""
Cross-repository dependency graph builder.

Creates a graph where:
  nodes = repositories in the group
  edges = repo A → repo B when A's wiki content mentions B's name/path

This relies on data already stored in the DB (wiki pages + repo metadata)
so it doesn't require additional API calls.
"""
from __future__ import annotations

import logging

from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.models.db_models import Repository, WikiPage

logger = logging.getLogger(__name__)


async def build_cross_repo_graph(repo_ids: list[int]) -> dict:
    """Build a cross-repo dependency graph from wiki content.

    Scans wiki pages for mentions of both within-group repos (internal edges)
    and any other globally-indexed repos (external edges with "external": True).
    External repo names are appended to nodes so the full dependency surface is
    visible, and the external edges let query endpoints expand their search scope
    to include those repos automatically.

    Returns {"nodes": [...], "edges": [...]} compatible with DependencyGraphResponse.
    Edges may carry an "external": True key for cross-group dependencies.
    """
    if not repo_ids:
        return {"nodes": [], "edges": []}

    async with AsyncSessionLocal() as session:
        group_repos = (
            await session.execute(
                select(Repository).where(Repository.id.in_(repo_ids))
            )
        ).scalars().all()

        # All repos outside this group that are already indexed in Qdrant.
        external_repos = (
            await session.execute(
                select(Repository).where(
                    Repository.id.notin_(repo_ids),
                    Repository.indexed_in_qdrant == True,  # noqa: E712
                )
            )
        ).scalars().all()

        nodes: list[str] = [r.name for r in group_repos]
        edges: list[dict] = []
        seen_edges: set[tuple[str, str]] = set()
        external_nodes_added: set[str] = set()

        for repo in group_repos:
            pages = (
                await session.execute(
                    select(WikiPage.content_markdown).where(WikiPage.repository_id == repo.id)
                )
            ).scalars().all()
            combined_text = " ".join(pages).lower()

            # Internal deps — within the same group.
            for other in group_repos:
                if other.id == repo.id:
                    continue
                other_name = other.name.lower()
                other_path_base = other.project_path.lower().split("/")[-1]
                if other_name in combined_text or (
                    len(other_path_base) > 3 and other_path_base in combined_text
                ):
                    key = (repo.name, other.name)
                    if key not in seen_edges:
                        seen_edges.add(key)
                        edges.append({"source": repo.name, "target": other.name, "weight": 1})

            # External deps — repos indexed in other groups.
            for other in external_repos:
                other_name = other.name.lower()
                other_path_base = other.project_path.lower().split("/")[-1]
                if other_name in combined_text or (
                    len(other_path_base) > 3 and other_path_base in combined_text
                ):
                    key = (repo.name, other.name)
                    if key not in seen_edges:
                        seen_edges.add(key)
                        edges.append({
                            "source": repo.name,
                            "target": other.name,
                            "weight": 1,
                            "external": True,
                        })
                        if other.name not in external_nodes_added:
                            external_nodes_added.add(other.name)
                            nodes.append(other.name)

    return {"nodes": nodes, "edges": edges}
