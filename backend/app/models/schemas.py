"""
Esquemas Pydantic usados en la API (request/response).
Separados de los modelos de DB para no acoplar el contrato HTTP al esquema de tablas.
"""
import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


# ---------- Requests ----------

class IndexRepositoryRequest(BaseModel):
    gitlab_url: str = Field(..., min_length=1, max_length=512, description="URL base de la instancia GitLab, ej. https://gitlab.com")
    project_path: str = Field(..., min_length=1, max_length=512, description="Ruta del proyecto, ej. mi-grupo/mi-proyecto")
    private_token: str = Field(..., min_length=1, max_length=512, description="Personal Access Token de GitLab (scope: read_api, read_repository)")
    branch: str | None = Field(default=None, max_length=255, description="Branch a indexar; si se omite usa el default del repo")
    force_reindex: bool = Field(
        default=False,
        description="Si True, regenera el wiki aunque el commit no haya cambiado desde el último indexado",
    )

    @field_validator("gitlab_url")
    @classmethod
    def validate_gitlab_url(cls, v: str) -> str:
        v = v.rstrip("/")
        if not re.match(r"^https?://", v, re.IGNORECASE):
            raise ValueError("gitlab_url debe comenzar con http:// o https://")
        return v

    @field_validator("project_path")
    @classmethod
    def validate_project_path(cls, v: str) -> str:
        v = v.strip("/")
        if not v or ".." in v:
            raise ValueError("project_path inválido")
        return v


class ChatHistoryMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str = Field(..., max_length=4000)


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    history: list[ChatHistoryMessage] = Field(default_factory=list, max_length=20)


class CodeSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500, description="Texto a buscar semánticamente en el código del repo")
    top_k: int | None = Field(default=None, ge=1, le=50, description="Número de resultados a devolver; usa el default del backend si se omite")


class PushToGitLabWikiRequest(BaseModel):
    """Credentials needed to push the generated wiki to GitLab's built-in wiki."""
    private_token: str = Field(..., min_length=1, max_length=512, description="PAT with api or write_wiki scope")


# ---------- Responses ----------

class IndexJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    job_id: int
    repository_id: int
    status: str
    progress: int
    current_step: str
    error_message: str = ""


class RepositorySummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    gitlab_url: str
    project_path: str
    name: str
    description: str
    default_branch: str
    last_commit_sha: str
    indexed_in_qdrant: bool
    is_monorepo: bool = False
    workspace_roots: list[str] | None = None
    webhook_secret: str = ""
    # True when a per-repo PAT has been stored for webhook re-indexing (token is never returned)
    gitlab_token_set: bool = False
    system_prompt: str = ""
    prompt_overrides: dict | None = None
    wiki_language: str = ""
    updated_at: datetime

    @classmethod
    def from_orm_with_extras(cls, repo) -> "RepositorySummary":
        """Build a summary, computing derived boolean fields that ORM can't map directly."""
        return cls(
            id=repo.id,
            gitlab_url=repo.gitlab_url,
            project_path=repo.project_path,
            name=repo.name,
            description=repo.description,
            default_branch=repo.default_branch,
            last_commit_sha=repo.last_commit_sha,
            indexed_in_qdrant=repo.indexed_in_qdrant,
            is_monorepo=repo.is_monorepo,
            workspace_roots=repo.workspace_roots,
            webhook_secret=repo.webhook_secret,
            gitlab_token_set=bool(repo.gitlab_token),
            system_prompt=repo.system_prompt or "",
            prompt_overrides=repo.prompt_overrides,
            wiki_language=repo.wiki_language or "",
            updated_at=repo.updated_at,
        )


class WikiPageSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    slug: str
    title: str
    order: int
    parent_slug: str


class WikiPageDetail(WikiPageSummary):
    model_config = ConfigDict(from_attributes=True)

    content_markdown: str
    source_files: list[str]
    is_ai_generated: bool = False


class WikiRevisionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    wiki_page_id: int
    is_ai_generated: bool
    created_at: datetime
    content_preview: str = ""


class WikiStructureResponse(BaseModel):
    repository: RepositorySummary
    pages: list[WikiPageSummary]


class CodeSource(BaseModel):
    """Un fragmento de código real usado como contexto para generar una respuesta del chat."""
    file_path: str
    start_line: int
    end_line: int
    content: str
    score: float


class CodeSearchResponse(BaseModel):
    results: list[CodeSource] = []


class GraphEdge(BaseModel):
    source: str
    target: str
    weight: int


class DependencyGraphResponse(BaseModel):
    nodes: list[str] = []
    edges: list[GraphEdge] = []


class WikiPageUpdate(BaseModel):
    content_markdown: str = Field(..., min_length=0, max_length=500_000)


class WikiTextSearchResult(BaseModel):
    slug: str
    title: str
    excerpt: str


class RepoWebhookSecretUpdate(BaseModel):
    webhook_secret: str = Field(default="", max_length=128)


class RepoGitLabTokenUpdate(BaseModel):
    """Store a PAT so webhook-triggered re-indexing works without a global default token."""
    gitlab_token: str = Field(default="", max_length=512)


class RepoSystemPromptUpdate(BaseModel):
    """Custom LLM system prompt override for this repo's wiki generation. Empty = use default."""
    system_prompt: str = Field(default="", max_length=10_000)


class RepoPromptOverridesUpdate(BaseModel):
    """JSON dict overriding specific prompt template keys (overview, architecture, module, setup).
    Pass null to clear all overrides and restore language defaults."""
    prompt_overrides: dict | None = None


class RepoWikiLanguageUpdate(BaseModel):
    """ISO language code for this repo's wiki generation. Empty = use global WIKI_LANGUAGE setting."""
    wiki_language: str = Field(default="", max_length=8)


class BranchListRequest(BaseModel):
    """Used by the connect form to fetch available branches before indexing."""
    gitlab_url: str = Field(..., min_length=1, max_length=512)
    project_path: str = Field(..., min_length=1, max_length=512)
    private_token: str = Field(..., min_length=1, max_length=512)


class ChatResponse(BaseModel):
    answer: str
    sources: list[CodeSource] = []


class GitLabWebhookPayload(BaseModel):
    model_config = ConfigDict(extra="allow")

    object_kind: str = ""
    ref: str = ""
    checkout_sha: str = ""
    project: dict = Field(default_factory=dict)


class PushToGitLabWikiResponse(BaseModel):
    ok: bool
    pages_pushed: int
    errors: list[str] = []


# ---------- Group requests ----------

class IndexGroupRequest(BaseModel):
    gitlab_url: str = Field(..., min_length=1, max_length=512, description="URL base de la instancia GitLab")
    group_path: str = Field(..., min_length=1, max_length=512, description="Ruta del grupo, ej. mi-empresa/equipo-a")
    private_token: str = Field(..., min_length=1, max_length=512, description="PAT con scope read_api, read_repository")
    force_reindex: bool = Field(default=False, description="Si True, regenera el wiki aunque no haya cambios")
    include_subgroups: bool = Field(default=True, description="Si True, incluye proyectos de subgrupos")

    @field_validator("gitlab_url")
    @classmethod
    def validate_gitlab_url(cls, v: str) -> str:
        v = v.rstrip("/")
        if not re.match(r"^https?://", v, re.IGNORECASE):
            raise ValueError("gitlab_url debe comenzar con http:// o https://")
        return v

    @field_validator("group_path")
    @classmethod
    def validate_group_path(cls, v: str) -> str:
        v = v.strip("/")
        if not v or ".." in v:
            raise ValueError("group_path inválido")
        return v


class CrossRepoSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500)
    top_k: int = Field(default=10, ge=1, le=50)
    repo_ids: list[int] | None = Field(default=None, description="Limitar a estos repos; None = todos los del grupo")


# ---------- Group responses ----------

class GroupRepoStatusResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_path: str
    repository_id: int | None
    status: str
    error_message: str


class GroupJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    job_id: int
    group_id: int
    status: str
    total_repos: int
    completed_repos: int
    failed_repos: int
    current_step: str
    error_summary: str = ""
    repo_statuses: list[GroupRepoStatusResponse] = []


class GroupSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    gitlab_url: str
    group_path: str
    gitlab_group_id: str
    name: str
    description: str
    updated_at: datetime


class GroupDetail(GroupSummary):
    overview_markdown: str
    repositories: list[RepositorySummary] = []
    cross_repo_graph: dict = Field(default_factory=dict)


class CrossRepoSearchResult(CodeSource):
    repository_id: int
    repository_name: str
    repository_path: str


class CrossRepoSearchResponse(BaseModel):
    results: list[CrossRepoSearchResult] = []
