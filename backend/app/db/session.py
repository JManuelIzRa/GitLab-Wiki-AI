"""
Configuración del motor async de SQLAlchemy y utilidades de sesión.
"""
from collections.abc import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.models.db_models import Base

engine = create_async_engine(settings.database_url, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

# Columns added after the initial schema that must be migrated on existing databases.
_MIGRATIONS = [
    "ALTER TABLE repositories ADD COLUMN file_hashes JSON DEFAULT NULL",
]


async def init_db() -> None:
    """Creates tables if they don't exist and applies lightweight column migrations."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for stmt in _MIGRATIONS:
            try:
                await conn.execute(text(stmt))
            except Exception:
                pass  # Column already exists


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Dependency de FastAPI para inyectar una sesión de DB por request."""
    async with AsyncSessionLocal() as session:
        yield session
