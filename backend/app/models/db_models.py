"""
Modelos de base de datos.

Un Repository representa un proyecto GitLab indexado.
Un IndexJob representa una ejecución de indexado (con su estado y progreso).
Una WikiPage es una página generada del wiki, ligada a un Repository.
WikiPageRevision rastrea el historial de ediciones para permitir restaurar versiones.
WikiCache persiste las respuestas de chat para sobrevivir reinicios del servidor.
GitLabGroup / GroupIndexJob / GroupRepoStatus modelan el soporte de grupos GitLab.
"""
from datetime import datetime, timezone
from enum import Enum

from sqlalchemy import Boolean, Index, String, Text, DateTime, ForeignKey, Integer, JSON, UniqueConstraint
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


class GroupIndexStatus(str, Enum):
    PENDING = "pending"
    DISCOVERING = "discovering"
    INDEXING = "indexing"
    GENERATING_OVERVIEW = "generating_overview"
    DONE = "done"
    FAILED = "failed"


class GitLabGroup(Base):
    """A GitLab group (or subgroup) whose repositories have been collectively indexed."""
    __tablename__ = "gitlab_groups"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    gitlab_url: Mapped[str] = mapped_column(String(512), index=True)
    group_path: Mapped[str] = mapped_column(String(512), index=True)
    gitlab_group_id: Mapped[str] = mapped_column(String(64), default="")
    name: Mapped[str] = mapped_column(String(256))
    description: Mapped[str] = mapped_column(Text, default="")
    overview_markdown: Mapped[str] = mapped_column(Text, default="")
    cross_repo_graph: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    group_jobs: Mapped[list["GroupIndexJob"]] = relationship(
        back_populates="group", cascade="all, delete-orphan"
    )


class GroupIndexJob(Base):
    """Tracks the progress of indexing all repositories in a GitLab group."""
    __tablename__ = "group_index_jobs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("gitlab_groups.id"), index=True)
    status: Mapped[str] = mapped_column(String(32), default=GroupIndexStatus.PENDING.value)
    total_repos: Mapped[int] = mapped_column(Integer, default=0)
    completed_repos: Mapped[int] = mapped_column(Integer, default=0)
    failed_repos: Mapped[int] = mapped_column(Integer, default=0)
    current_step: Mapped[str] = mapped_column(String(256), default="")
    error_summary: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    group: Mapped["GitLabGroup"] = relationship(back_populates="group_jobs")
    repo_statuses: Mapped[list["GroupRepoStatus"]] = relationship(
        back_populates="group_job", cascade="all, delete-orphan"
    )


class GroupMembership(Base):
    """Many-to-many link between GitLabGroup and Repository.

    A repository can belong to multiple groups (e.g. a shared library indexed
    under both group-a and group-b). This table replaces the single group_id FK
    on Repository for all cross-group queries.
    """
    __tablename__ = "group_memberships"
    __table_args__ = (
        UniqueConstraint("group_id", "repository_id", name="uq_group_membership"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("gitlab_groups.id", ondelete="CASCADE"), index=True)
    repository_id: Mapped[int] = mapped_column(ForeignKey("repositories.id", ondelete="CASCADE"), index=True)


class GroupRepoStatus(Base):
    """Per-repo progress record within a single GroupIndexJob."""
    __tablename__ = "group_repo_statuses"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    group_job_id: Mapped[int] = mapped_column(ForeignKey("group_index_jobs.id"), index=True)
    project_path: Mapped[str] = mapped_column(String(512))
    repository_id: Mapped[int | None] = mapped_column(
        ForeignKey("repositories.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(32), default="pending")
    error_message: Mapped[str] = mapped_column(Text, default="")

    group_job: Mapped["GroupIndexJob"] = relationship(back_populates="repo_statuses")


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
    indexed_in_qdrant: Mapped[bool] = mapped_column(default=False)
    dependency_graph: Mapped[dict] = mapped_column(JSON, default=dict)
    file_hashes: Mapped[dict | None] = mapped_column(JSON, nullable=True, default=None)
    # Monorepo metadata populated by structure_analyzer
    is_monorepo: Mapped[bool] = mapped_column(Boolean, default=False)
    workspace_roots: Mapped[list | None] = mapped_column(JSON, nullable=True, default=None)
    # Per-repo webhook secret for validating GitLab push webhooks (overrides global setting).
    webhook_secret: Mapped[str] = mapped_column(String(128), default="")
    # Optional PAT stored for webhook-triggered re-indexing (never returned by the API).
    gitlab_token: Mapped[str] = mapped_column(String(512), default="")
    # Custom LLM system prompt override for this repo's wiki generation (empty = use default).
    system_prompt: Mapped[str] = mapped_column(Text, default="")
    # Optional FK to the GitLab group this repo belongs to (SET NULL on group delete)
    group_id: Mapped[int | None] = mapped_column(
        ForeignKey("gitlab_groups.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    pages: Mapped[list["WikiPage"]] = relationship(back_populates="repository", cascade="all, delete-orphan")
    jobs: Mapped[list["IndexJob"]] = relationship(back_populates="repository", cascade="all, delete-orphan")
    cache_entries: Mapped[list["WikiCache"]] = relationship(back_populates="repository", cascade="all, delete-orphan")


class IndexJob(Base):
    __tablename__ = "index_jobs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    repository_id: Mapped[int] = mapped_column(ForeignKey("repositories.id"), index=True)
    status: Mapped[str] = mapped_column(String(32), default=JobStatus.PENDING.value)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    current_step: Mapped[str] = mapped_column(String(256), default="")
    error_message: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    repository: Mapped["Repository"] = relationship(back_populates="jobs")


class WikiPage(Base):
    __tablename__ = "wiki_pages"
    __table_args__ = (Index("ix_wiki_pages_repo_slug", "repository_id", "slug"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    repository_id: Mapped[int] = mapped_column(ForeignKey("repositories.id"), index=True)
    slug: Mapped[str] = mapped_column(String(256), index=True)
    title: Mapped[str] = mapped_column(String(256))
    order: Mapped[int] = mapped_column(Integer, default=0)
    parent_slug: Mapped[str] = mapped_column(String(256), default="")
    content_markdown: Mapped[str] = mapped_column(Text, default="")
    source_files: Mapped[list] = mapped_column(JSON, default=list)
    source_hash: Mapped[str] = mapped_column(String(64), default="")
    # True when this content was generated by the LLM (not a manual edit or reused content).
    # Used by the revision system to label the "AI version" baseline.
    is_ai_generated: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    repository: Mapped["Repository"] = relationship(back_populates="pages")
    revisions: Mapped[list["WikiPageRevision"]] = relationship(
        back_populates="wiki_page", cascade="all, delete-orphan", order_by="WikiPageRevision.created_at.desc()"
    )


class WikiPageRevision(Base):
    """Immutable snapshot of a wiki page's content at a point in time.

    A new revision is saved automatically whenever a page is edited via the PATCH endpoint,
    so users can roll back to any previous version (including the original AI-generated one).
    """
    __tablename__ = "wiki_page_revisions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    wiki_page_id: Mapped[int] = mapped_column(
        ForeignKey("wiki_pages.id", ondelete="CASCADE"), index=True
    )
    content_markdown: Mapped[str] = mapped_column(Text)
    is_ai_generated: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    wiki_page: Mapped["WikiPage"] = relationship(back_populates="revisions")


class WikiCache(Base):
    """Persistent LRU cache for RAG chat answers, keyed by (repository_id, question_hash).

    Replaces the previous in-memory OrderedDict so cached answers survive server restarts
    and cache invalidation on re-index is durable across processes.
    """
    __tablename__ = "wiki_cache"
    __table_args__ = (
        UniqueConstraint("repository_id", "question_hash", name="uq_wiki_cache_repo_question"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    repository_id: Mapped[int] = mapped_column(
        ForeignKey("repositories.id", ondelete="CASCADE"), index=True
    )
    question_hash: Mapped[str] = mapped_column(String(32))
    answer: Mapped[str] = mapped_column(Text)
    sources_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    repository: Mapped["Repository"] = relationship(back_populates="cache_entries")
