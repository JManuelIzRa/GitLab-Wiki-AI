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
    # Existing migrations (kept for backwards compatibility with existing deployments)
    "ALTER TABLE repositories ADD COLUMN file_hashes JSON DEFAULT NULL",
    "CREATE INDEX IF NOT EXISTS ix_wiki_pages_repository_id ON wiki_pages (repository_id)",
    "CREATE INDEX IF NOT EXISTS ix_index_jobs_repository_id ON index_jobs (repository_id)",
    "CREATE INDEX IF NOT EXISTS ix_wiki_pages_repo_slug ON wiki_pages (repository_id, slug)",
    "ALTER TABLE wiki_pages ADD COLUMN source_hash TEXT DEFAULT ''",
    # New migrations for wiki versioning, persistent cache, and monorepo support
    "ALTER TABLE wiki_pages ADD COLUMN is_ai_generated INTEGER DEFAULT 0",
    "ALTER TABLE repositories ADD COLUMN is_monorepo INTEGER DEFAULT 0",
    "ALTER TABLE repositories ADD COLUMN workspace_roots JSON DEFAULT NULL",
    (
        "CREATE TABLE IF NOT EXISTS wiki_page_revisions ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  wiki_page_id INTEGER NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,"
        "  content_markdown TEXT NOT NULL,"
        "  is_ai_generated INTEGER NOT NULL DEFAULT 0,"
        "  created_at DATETIME NOT NULL"
        ")"
    ),
    "CREATE INDEX IF NOT EXISTS ix_wiki_page_revisions_page ON wiki_page_revisions (wiki_page_id)",
    (
        "CREATE TABLE IF NOT EXISTS wiki_cache ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,"
        "  question_hash TEXT NOT NULL,"
        "  answer TEXT NOT NULL,"
        "  sources_json TEXT NOT NULL DEFAULT '[]',"
        "  created_at DATETIME NOT NULL,"
        "  UNIQUE(repository_id, question_hash)"
        ")"
    ),
    "CREATE INDEX IF NOT EXISTS ix_wiki_cache_repo ON wiki_cache (repository_id)",
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
