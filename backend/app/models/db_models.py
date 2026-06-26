"""
Modelos de base de datos.

Un Repository representa un proyecto GitLab indexado.
Un IndexJob representa una ejecución de indexado (con su estado y progreso).
Una WikiPage es una página generada del wiki, ligada a un Repository.
"""
from datetime import datetime, timezone
from enum import Enum

from sqlalchemy import String, Text, DateTime, ForeignKey, Integer, JSON
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class JobStatus(str, Enum):
    PENDING = "pending"
    CLONING = "cloning"
    ANALYZING = "analyzing"
    GENERATING = "generating"
    EMBEDDING = "embedding"
    DONE = "done"
    FAILED = "failed"


class Repository(Base):
    __tablename__ = "repositories"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    gitlab_url: Mapped[str] = mapped_column(String(512), index=True)
    project_path: Mapped[str] = mapped_column(String(512), index=True)
    project_id: Mapped[str] = mapped_column(String(64))
    default_branch: Mapped[str] = mapped_column(String(128), default="main")
    name: Mapped[str] = mapped_column(String(256))
    description: Mapped[str] = mapped_column(Text, default="")
    last_commit_sha: Mapped[str] = mapped_column(String(64), default="")
    indexed_in_qdrant: Mapped[bool] = mapped_column(default=False)  # True si el código se embebió correctamente
    dependency_graph: Mapped[dict] = mapped_column(JSON, default=dict)  # {"nodes": [...], "edges": [...]}
    file_hashes: Mapped[dict | None] = mapped_column(JSON, nullable=True, default=None)  # {path: sha256} for incremental re-embedding
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    pages: Mapped[list["WikiPage"]] = relationship(back_populates="repository", cascade="all, delete-orphan")
    jobs: Mapped[list["IndexJob"]] = relationship(back_populates="repository", cascade="all, delete-orphan")


class IndexJob(Base):
    __tablename__ = "index_jobs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    repository_id: Mapped[int] = mapped_column(ForeignKey("repositories.id"))
    status: Mapped[str] = mapped_column(String(32), default=JobStatus.PENDING.value)
    progress: Mapped[int] = mapped_column(Integer, default=0)       # 0-100
    current_step: Mapped[str] = mapped_column(String(256), default="")
    error_message: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    repository: Mapped["Repository"] = relationship(back_populates="jobs")


class WikiPage(Base):
    __tablename__ = "wiki_pages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    repository_id: Mapped[int] = mapped_column(ForeignKey("repositories.id"))
    slug: Mapped[str] = mapped_column(String(256), index=True)
    title: Mapped[str] = mapped_column(String(256))
    order: Mapped[int] = mapped_column(Integer, default=0)
    parent_slug: Mapped[str] = mapped_column(String(256), default="")  # para jerarquía en el sidebar
    content_markdown: Mapped[str] = mapped_column(Text, default="")
    source_files: Mapped[list] = mapped_column(JSON, default=list)     # lista de paths usados como fuente
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    repository: Mapped["Repository"] = relationship(back_populates="pages")
