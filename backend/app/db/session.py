"""
Configuración del motor async de SQLAlchemy y utilidades de sesión.
"""
from collections.abc import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.models.db_models import Base

engine = create_async_engine(settings.database_url, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

# DDL statements applied on startup. Use IF NOT EXISTS / IF EXISTS where possible
# so they are idempotent. ALTER TABLE (no IF NOT EXISTS in SQLite) is wrapped in a
# targeted except that re-raises anything other than "column already exists".
_MIGRATIONS = [
    "ALTER TABLE repositories ADD COLUMN file_hashes JSON DEFAULT NULL",
    "CREATE INDEX IF NOT EXISTS ix_wiki_pages_repository_id ON wiki_pages (repository_id)",
    "CREATE INDEX IF NOT EXISTS ix_index_jobs_repository_id ON index_jobs (repository_id)",
    "CREATE INDEX IF NOT EXISTS ix_wiki_pages_repo_slug ON wiki_pages (repository_id, slug)",
    "ALTER TABLE wiki_pages ADD COLUMN source_hash TEXT DEFAULT ''",
]


async def init_db() -> None:
    """Creates tables if they don't exist and applies lightweight column migrations."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for stmt in _MIGRATIONS:
            try:
                await conn.execute(text(stmt))
            except OperationalError as exc:
                msg = str(exc).lower()
                if "duplicate column" not in msg and "already exists" not in msg:
                    raise


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Dependency de FastAPI para inyectar una sesión de DB por request."""
    async with AsyncSessionLocal() as session:
        yield session
