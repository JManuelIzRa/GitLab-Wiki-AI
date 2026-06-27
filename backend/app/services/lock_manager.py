"""
DB-level advisory lock for repo indexing.

Uses a unique-constrained INSERT into `index_locks` to guarantee mutual exclusion
across processes and instances — replacing the previous in-process asyncio.Lock dict
which only protected against concurrent requests within a single process.

The lock is held only for the job-creation window (a few database writes), not for
the duration of indexing. Expired locks from crashed workers are cleaned up on the
next acquisition attempt.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta

from fastapi import HTTPException
from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError

from app.db.session import AsyncSessionLocal
from app.models.db_models import IndexLock

logger = logging.getLogger(__name__)

_LOCK_TTL_SECONDS = 60


@asynccontextmanager
async def repo_index_lock(repo_key: str):
    """Acquire a DB-level advisory lock for the given repo_key.

    Raises HTTP 409 immediately if another process already holds the lock.
    Yields once the lock is acquired; releases on exit (success or error).
    """
    async with AsyncSessionLocal() as session:
        now = datetime.now(timezone.utc)
        await session.execute(delete(IndexLock).where(IndexLock.expires_at < now))
        await session.commit()

        expires_at = now + timedelta(seconds=_LOCK_TTL_SECONDS)
        lock = IndexLock(repo_key=repo_key, expires_at=expires_at)
        session.add(lock)
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            raise HTTPException(
                status_code=409,
                detail="Ya hay una operación de indexado activa para este repositorio. Intenta de nuevo en unos segundos.",
            )
        lock_id = lock.id

    try:
        yield
    finally:
        async with AsyncSessionLocal() as session:
            await session.execute(delete(IndexLock).where(IndexLock.id == lock_id))
            await session.commit()
