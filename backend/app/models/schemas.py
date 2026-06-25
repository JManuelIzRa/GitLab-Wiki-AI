"""
Esquemas Pydantic usados en la API (request/response).
Separados de los modelos de DB para no acoplar el contrato HTTP al esquema de tablas.
"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


# ---------- Requests ----------

class IndexRepositoryRequest(BaseModel):
    gitlab_url: str = Field(..., description="URL base de la instancia GitLab, ej. https://gitlab.com")
    project_path: str = Field(..., description="Ruta del proyecto, ej. mi-grupo/mi-proyecto")
    private_token: str = Field(..., description="Personal Access Token de GitLab (scope: read_api, read_repository)")
    branch: str | None = Field(default=None, description="Branch a indexar; si se omite usa el default del repo")
    force_reindex: bool = Field(
        default=False,
        description="Si True, regenera el wiki aunque el commit no haya cambiado desde el último indexado",
    )


class ChatRequest(BaseModel):
    question: str


class CodeSearchRequest(BaseModel):
    query: str = Field(..., description="Texto a buscar semánticamente en el código del repo")
    top_k: int | None = Field(default=None, description="Número de resultados a devolver; usa el default del backend si se omite")


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
    updated_at: datetime


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


class ChatResponse(BaseModel):
    answer: str
    sources: list[CodeSource] = []
