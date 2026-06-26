"""DB-backed LRU chat-answer cache shared between route modules."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.db_models import WikiCache


def cache_key(question: str) -> str:
    return hashlib.sha256(question.encode()).hexdigest()[:32]


async def db_cache_get(
    session: AsyncSession, repo_id: int, question: str
) -> tuple[str, list] | None:
    q_hash = cache_key(question)
    row = (
        await session.execute(
            select(WikiCache).where(
                WikiCache.repository_id == repo_id,
                WikiCache.question_hash == q_hash,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    try:
        sources = json.loads(row.sources_json)
    except Exception:
        sources = []
    return row.answer, sources


async def db_cache_set(
    session: AsyncSession,
    repo_id: int,
    question: str,
    answer: str,
    sources: list,
) -> None:
    q_hash = cache_key(question)
    stmt = (
        sqlite_insert(WikiCache)
        .values(
            repository_id=repo_id,
            question_hash=q_hash,
            answer=answer,
            sources_json=json.dumps(sources),
            created_at=datetime.now(timezone.utc),
        )
        .on_conflict_do_update(
            index_elements=["repository_id", "question_hash"],
            set_={
                "answer": answer,
                "sources_json": json.dumps(sources),
                "created_at": datetime.now(timezone.utc),
            },
        )
    )
    await session.execute(stmt)

    # Evict oldest entries when the per-repo count exceeds the cap.
    await session.execute(
        delete(WikiCache).where(
            WikiCache.id.in_(
                select(WikiCache.id)
                .where(WikiCache.repository_id == repo_id)
                .order_by(WikiCache.created_at.desc())
                .offset(settings.chat_cache_max)
            )
        )
    )
    await session.commit()


async def db_cache_invalidate(session: AsyncSession, repo_id: int) -> None:
    await session.execute(delete(WikiCache).where(WikiCache.repository_id == repo_id))
    await session.commit()
