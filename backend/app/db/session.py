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
    # Group support (Path B)
    (
        "CREATE TABLE IF NOT EXISTS gitlab_groups ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  gitlab_url TEXT NOT NULL,"
        "  group_path TEXT NOT NULL,"
        "  gitlab_group_id TEXT NOT NULL DEFAULT '',"
        "  name TEXT NOT NULL,"
        "  description TEXT NOT NULL DEFAULT '',"
        "  overview_markdown TEXT NOT NULL DEFAULT '',"
        "  cross_repo_graph JSON NOT NULL DEFAULT '{}',"
        "  created_at DATETIME NOT NULL,"
        "  updated_at DATETIME NOT NULL"
        ")"
    ),
    "CREATE INDEX IF NOT EXISTS ix_gitlab_groups_url ON gitlab_groups (gitlab_url)",
    "CREATE INDEX IF NOT EXISTS ix_gitlab_groups_path ON gitlab_groups (group_path)",
    (
        "CREATE TABLE IF NOT EXISTS group_index_jobs ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  group_id INTEGER NOT NULL REFERENCES gitlab_groups(id),"
        "  status TEXT NOT NULL DEFAULT 'pending',"
        "  total_repos INTEGER NOT NULL DEFAULT 0,"
        "  completed_repos INTEGER NOT NULL DEFAULT 0,"
        "  failed_repos INTEGER NOT NULL DEFAULT 0,"
        "  current_step TEXT NOT NULL DEFAULT '',"
        "  error_summary TEXT NOT NULL DEFAULT '',"
        "  created_at DATETIME NOT NULL,"
        "  finished_at DATETIME"
        ")"
    ),
    "CREATE INDEX IF NOT EXISTS ix_group_index_jobs_group ON group_index_jobs (group_id)",
    (
        "CREATE TABLE IF NOT EXISTS group_repo_statuses ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  group_job_id INTEGER NOT NULL REFERENCES group_index_jobs(id),"
        "  project_path TEXT NOT NULL,"
        "  repository_id INTEGER REFERENCES repositories(id) ON DELETE SET NULL,"
        "  status TEXT NOT NULL DEFAULT 'pending',"
        "  error_message TEXT NOT NULL DEFAULT ''"
        ")"
    ),
    "CREATE INDEX IF NOT EXISTS ix_group_repo_statuses_job ON group_repo_statuses (group_job_id)",
    "ALTER TABLE repositories ADD COLUMN group_id INTEGER DEFAULT NULL REFERENCES gitlab_groups(id) ON DELETE SET NULL",
    "CREATE INDEX IF NOT EXISTS ix_repositories_group ON repositories (group_id)",
    # Many-to-many group ↔ repo memberships (replaces single FK for cross-group repos)
    (
        "CREATE TABLE IF NOT EXISTS group_memberships ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  group_id INTEGER NOT NULL REFERENCES gitlab_groups(id) ON DELETE CASCADE,"
        "  repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,"
        "  UNIQUE(group_id, repository_id)"
        ")"
    ),
    "CREATE INDEX IF NOT EXISTS ix_group_memberships_group ON group_memberships (group_id)",
    "CREATE INDEX IF NOT EXISTS ix_group_memberships_repo ON group_memberships (repository_id)",
    # Per-repo webhook secret (overrides global GITLAB_WEBHOOK_SECRET per repo)
    "ALTER TABLE repositories ADD COLUMN webhook_secret TEXT NOT NULL DEFAULT ''",
    # Per-repo PAT for webhook-triggered re-indexing (never exposed in API responses)
    "ALTER TABLE repositories ADD COLUMN gitlab_token TEXT NOT NULL DEFAULT ''",
    # Custom LLM system prompt override per repo (empty = use default prompts)
    "ALTER TABLE repositories ADD COLUMN system_prompt TEXT NOT NULL DEFAULT ''",
    # FTS5 virtual table for full-text wiki page search
    (
        "CREATE VIRTUAL TABLE IF NOT EXISTS wiki_pages_fts USING fts5("
        "  title, content_markdown,"
        "  content=wiki_pages, content_rowid=id"
        ")"
    ),
    # DB-level advisory lock table (replaces in-process asyncio.Lock dict)
    (
        "CREATE TABLE IF NOT EXISTS index_locks ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  repo_key TEXT NOT NULL UNIQUE,"
        "  locked_at DATETIME NOT NULL,"
        "  expires_at DATETIME NOT NULL"
        ")"
    ),
    "CREATE INDEX IF NOT EXISTS ix_index_locks_expires ON index_locks (expires_at)",
    # Per-repo prompt template overrides and language
    "ALTER TABLE repositories ADD COLUMN prompt_overrides JSON DEFAULT NULL",
    "ALTER TABLE repositories ADD COLUMN wiki_language TEXT NOT NULL DEFAULT ''",
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
