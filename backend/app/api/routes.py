"""
Endpoints REST de la aplicación.

Convención de rutas:
- POST /api/repositories/index               -> arranca un job de indexado (no bloqueante)
- GET  /api/jobs/{job_id}                    -> consulta progreso de un job (para polling)
- GET  /api/jobs/{job_id}/stream             -> SSE stream de progreso
- GET  /api/repositories                     -> lista repos ya indexados
- GET  /api/repositories/{id}/wiki           -> estructura del wiki (lista de páginas, sin contenido)
- GET  /api/repositories/{id}/wiki/{slug}    -> contenido de una página específica
- PATCH /api/repositories/{id}/wiki/{slug}   -> editar manualmente una página
- GET  /api/repositories/{id}/wiki/{slug}/revisions        -> historial de revisiones de una página
- POST /api/repositories/{id}/wiki/{slug}/revisions/{rev_id}/restore -> restaurar revisión
- GET  /api/repositories/{id}/export         -> descarga el wiki completo como .md único
- GET  /api/repositories/{id}/dependency-graph -> grafo de dependencias entre módulos
- POST /api/repositories/{id}/search         -> búsqueda semántica directa sobre el código
- POST /api/repositories/{id}/chat           -> pregunta libre sobre el repo (RAG)
- POST /api/repositories/{id}/chat/stream    -> ídem, streaming SSE
- POST /api/repositories/{id}/push-to-gitlab-wiki -> empuja el wiki al wiki nativo de GitLab
- DELETE /api/repositories/{id}              -> borra un repo indexado y sus páginas

Group endpoints:
- POST /api/groups/index                     -> indexa todos los repos de un grupo GitLab
- GET  /api/groups                           -> lista grupos indexados
- GET  /api/groups/{id}                      -> detalle del grupo con repos
- GET  /api/groups/{id}/jobs/{job_id}        -> estado de un job de grupo
- GET  /api/groups/{id}/jobs/{job_id}/stream -> SSE stream del job de grupo
- GET  /api/groups/{id}/wiki                 -> overview wiki del grupo
- POST /api/groups/{id}/search               -> búsqueda semántica cross-repo
- POST /api/groups/{id}/chat                 -> chat RAG cross-repo
- POST /api/groups/{id}/chat/stream          -> ídem, streaming SSE
- GET  /api/groups/{id}/dependency-graph     -> grafo cross-repo
- DELETE /api/groups/{id}                    -> elimina el grupo y sus datos
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
from collections import defaultdict
from datetime import datetime, timezone

import openai
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, or_, select, text
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.rate_limit import limiter
from app.db.session import AsyncSessionLocal, get_session
from app.models.db_models import (
    GitLabGroup, GroupIndexJob, GroupIndexStatus, GroupMembership, GroupRepoStatus,
    IndexJob, JobStatus, Repository, WikiCache, WikiPage, WikiPageRevision,
)
from app.models.schemas import (
    ChatRequest, ChatResponse, CodeSearchRequest, CodeSearchResponse, CodeSource,
    CrossRepoSearchRequest, CrossRepoSearchResponse, CrossRepoSearchResult,
    DependencyGraphResponse, GitLabWebhookPayload, GroupDetail, GroupJobResponse,
    GroupRepoStatusResponse, GroupSummary, IndexGroupRequest, IndexJobResponse, IndexRepositoryRequest,
    PushToGitLabWikiRequest, PushToGitLabWikiResponse, RepoWebhookSecretUpdate,
    RepositorySummary, WikiPageDetail, WikiPageSummary, WikiPageUpdate,
    WikiRevisionResponse, WikiStructureResponse, WikiTextSearchResult,
)
from app.services.embedding_client import EmbeddingError, get_embedding_client
from app.services.gitlab_client import GitLabAuthError, GitLabClient, GitLabNotFoundError
from app.services.cross_repo_search import search_across_repos
from app.services.group_indexer import run_group_index_job
from app.services.indexer import run_index_job
from app.services.vector_store import VectorStore
from app.services.wiki_exporter import export_wiki_to_markdown
from app.services.wiki_generator import WikiGenerator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")

# ---------------------------------------------------------------------------
# Per-repo asyncio lock to prevent concurrent indexing of the same repository.
# Keyed by (gitlab_url, project_path) so two requests for the same repo but
# different token/branch combos are still serialised.
# This is process-scoped; for multi-worker deployments a DB advisory lock
# or Redis-based lock would be needed instead.
# ---------------------------------------------------------------------------
_index_locks: dict[tuple[str, str], asyncio.Lock] = defaultdict(asyncio.Lock)


def _repo_lock(gitlab_url: str, project_path: str) -> asyncio.Lock:
    return _index_locks[(gitlab_url.rstrip("/"), project_path.strip("/"))]


# ---------------------------------------------------------------------------
# DB-backed LRU chat cache.
# Answers are stored in the wiki_cache table so they survive server restarts.
# The "LRU" eviction is handled by keeping only the N most recent entries per
# repo and by the cascade delete when a repo is re-indexed.
# ---------------------------------------------------------------------------
_CHAT_CACHE_MAX = 256


def _cache_key(question: str) -> str:
    return hashlib.sha256(question.encode()).hexdigest()[:32]


async def _db_cache_get(session: AsyncSession, repo_id: int, question: str) -> tuple[str, list] | None:
    q_hash = _cache_key(question)
    row = (
        await session.execute(
            select(WikiCache).where(WikiCache.repository_id == repo_id, WikiCache.question_hash == q_hash)
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    try:
        sources = json.loads(row.sources_json)
    except Exception:
        sources = []
    return row.answer, sources


async def _db_cache_set(session: AsyncSession, repo_id: int, question: str, answer: str, sources: list) -> None:
    q_hash = _cache_key(question)
    # Upsert: replace existing entry if the same question was asked again.
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
            set_={"answer": answer, "sources_json": json.dumps(sources), "created_at": datetime.now(timezone.utc)},
        )
    )
    await session.execute(stmt)

    # Evict oldest entries in a single query when the per-repo count exceeds the cap.
    await session.execute(
        delete(WikiCache).where(
            WikiCache.id.in_(
                select(WikiCache.id)
                .where(WikiCache.repository_id == repo_id)
                .order_by(WikiCache.created_at.desc())
                .offset(_CHAT_CACHE_MAX)
            )
        )
    )

    await session.commit()


async def _db_cache_invalidate_repo(session: AsyncSession, repo_id: int) -> None:
    await session.execute(delete(WikiCache).where(WikiCache.repository_id == repo_id))
    await session.commit()


def _get_wiki_generator(request: Request) -> WikiGenerator:
    return request.app.state.wiki_generator


# ---------------------------------------------------------------------------
# Indexing
# ---------------------------------------------------------------------------

@router.post("/repositories/index", response_model=IndexJobResponse)
@limiter.limit(settings.rate_limit_index)
async def index_repository(
    request: Request,
    payload: IndexRepositoryRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
):
    """
    Crea (o reutiliza) el registro de Repository y lanza un IndexJob en background.
    Devuelve inmediatamente el job_id para que el frontend haga polling de progreso.

    Uses a per-repo asyncio lock so rapid duplicate requests are safely serialised
    rather than racing past the active-job check.
    """
    lock = _repo_lock(payload.gitlab_url, payload.project_path)
    async with lock:
        existing = (
            await session.execute(
                select(Repository).where(
                    Repository.gitlab_url == payload.gitlab_url,
                    Repository.project_path == payload.project_path,
                ).order_by(Repository.id.desc()).limit(1)
            )
        ).scalars().first()

        if existing is None:
            repo = Repository(
                gitlab_url=payload.gitlab_url,
                project_path=payload.project_path,
                project_id="",
                name=payload.project_path,
            )
            session.add(repo)
            await session.commit()
            await session.refresh(repo)
        else:
            repo = existing
            active_job = (
                await session.execute(
                    select(IndexJob)
                    .where(
                        IndexJob.repository_id == repo.id,
                        IndexJob.status.notin_([JobStatus.DONE.value, JobStatus.FAILED.value]),
                    )
                    .limit(1)
                )
            ).scalars().first()
            if active_job:
                raise HTTPException(
                    status_code=409,
                    detail=f"Ya hay un job de indexado activo (job_id={active_job.id}) para este repositorio. "
                           "Espera a que termine antes de relanzar.",
                )

        await _db_cache_invalidate_repo(session, repo.id)

        job = IndexJob(repository_id=repo.id, status=JobStatus.PENDING.value, progress=0, current_step="En cola...")
        session.add(job)
        await session.commit()
        await session.refresh(job)

    background_tasks.add_task(
        run_index_job, job.id, payload.gitlab_url, payload.project_path, payload.private_token,
        payload.branch, payload.force_reindex,
    )

    return IndexJobResponse(
        job_id=job.id, repository_id=repo.id, status=job.status, progress=job.progress, current_step=job.current_step,
    )


@router.get("/jobs/{job_id}", response_model=IndexJobResponse)
async def get_job_status(job_id: int, session: AsyncSession = Depends(get_session)):
    job = await session.get(IndexJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job no encontrado")
    return IndexJobResponse(
        job_id=job.id, repository_id=job.repository_id, status=job.status,
        progress=job.progress, current_step=job.current_step, error_message=job.error_message,
    )


@router.get("/jobs/{job_id}/stream")
async def stream_job_status(job_id: int):
    """
    SSE endpoint that pushes job progress updates until the job reaches a terminal state.
    Each event is a JSON-encoded IndexJobResponse. The connection closes automatically
    when the job is done or failed — no client-side polling needed.
    """
    async def event_generator():
        last_key: tuple | None = None
        while True:
            async with AsyncSessionLocal() as session:
                job = await session.get(IndexJob, job_id)
                if job is None:
                    yield f"data: {json.dumps({'error': 'Job no encontrado'})}\n\n"
                    return

                current_key = (job.status, job.progress, job.current_step)
                if current_key != last_key:
                    last_key = current_key
                    payload = IndexJobResponse(
                        job_id=job.id, repository_id=job.repository_id, status=job.status,
                        progress=job.progress, current_step=job.current_step,
                        error_message=job.error_message,
                    )
                    yield f"data: {payload.model_dump_json()}\n\n"

                terminal = job.status in (JobStatus.DONE.value, JobStatus.FAILED.value)

            if terminal:
                return
            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Repository listing and wiki structure
# ---------------------------------------------------------------------------

@router.get("/repositories", response_model=list[RepositorySummary])
async def list_repositories(
    session: AsyncSession = Depends(get_session),
    offset: int = Query(0, ge=0, description="Número de registros a saltar"),
    limit: int = Query(100, ge=1, le=500, description="Máximo de registros a devolver"),
):
    repos = (
        await session.execute(
            select(Repository).order_by(Repository.updated_at.desc()).offset(offset).limit(limit)
        )
    ).scalars().all()
    return repos


@router.get("/repositories/{repo_id}/wiki", response_model=WikiStructureResponse)
async def get_wiki_structure(repo_id: int, session: AsyncSession = Depends(get_session)):
    repo = await session.get(Repository, repo_id)
    if repo is None:
        raise HTTPException(status_code=404, detail="Repositorio no encontrado")
    pages = (
        await session.execute(select(WikiPage).where(WikiPage.repository_id == repo_id).order_by(WikiPage.order))
    ).scalars().all()
    return WikiStructureResponse(repository=repo, pages=pages)


@router.get("/repositories/{repo_id}/wiki/{slug}", response_model=WikiPageDetail)
async def get_wiki_page(repo_id: int, slug: str, session: AsyncSession = Depends(get_session)):
    page = (
        await session.execute(
            select(WikiPage).where(WikiPage.repository_id == repo_id, WikiPage.slug == slug)
        )
    ).scalar_one_or_none()
    if page is None:
        raise HTTPException(status_code=404, detail="Página no encontrada")
    return page


@router.patch("/repositories/{repo_id}/wiki/{slug}", response_model=WikiPageDetail)
async def update_wiki_page(
    repo_id: int,
    slug: str,
    payload: WikiPageUpdate,
    session: AsyncSession = Depends(get_session),
):
    """Persists a manual edit to a wiki page's markdown content.

    The current content is saved as a WikiPageRevision before being replaced,
    so users can restore any previous version via the revisions endpoints.
    """
    page = (
        await session.execute(
            select(WikiPage).where(WikiPage.repository_id == repo_id, WikiPage.slug == slug)
        )
    ).scalar_one_or_none()
    if page is None:
        raise HTTPException(status_code=404, detail="Página no encontrada")

    # Save a snapshot of the current content before overwriting it.
    revision = WikiPageRevision(
        wiki_page_id=page.id,
        content_markdown=page.content_markdown,
        is_ai_generated=page.is_ai_generated,
        created_at=datetime.now(timezone.utc),
    )
    session.add(revision)

    page.content_markdown = payload.content_markdown
    page.is_ai_generated = False  # manual edits are no longer AI-generated
    await session.commit()
    await session.refresh(page)
    return page


# ---------------------------------------------------------------------------
# Wiki revision history and restore
# ---------------------------------------------------------------------------

@router.get("/repositories/{repo_id}/wiki/{slug}/revisions", response_model=list[WikiRevisionResponse])
async def get_wiki_revisions(
    repo_id: int,
    slug: str,
    session: AsyncSession = Depends(get_session),
):
    """Returns the revision history for a wiki page (newest first, max 50)."""
    page = (
        await session.execute(
            select(WikiPage).where(WikiPage.repository_id == repo_id, WikiPage.slug == slug)
        )
    ).scalar_one_or_none()
    if page is None:
        raise HTTPException(status_code=404, detail="Página no encontrada")

    revisions = (
        await session.execute(
            select(WikiPageRevision)
            .where(WikiPageRevision.wiki_page_id == page.id)
            .order_by(WikiPageRevision.created_at.desc())
            .limit(50)
        )
    ).scalars().all()

    return [
        WikiRevisionResponse(
            id=r.id,
            wiki_page_id=r.wiki_page_id,
            is_ai_generated=r.is_ai_generated,
            created_at=r.created_at,
            content_preview=r.content_markdown[:300],
        )
        for r in revisions
    ]


@router.post("/repositories/{repo_id}/wiki/{slug}/revisions/{revision_id}/restore", response_model=WikiPageDetail)
async def restore_wiki_revision(
    repo_id: int,
    slug: str,
    revision_id: int,
    session: AsyncSession = Depends(get_session),
):
    """Restores a wiki page to a previous revision.

    The current content is saved as a new revision before being replaced,
    so the restore itself is reversible.
    """
    page = (
        await session.execute(
            select(WikiPage).where(WikiPage.repository_id == repo_id, WikiPage.slug == slug)
        )
    ).scalar_one_or_none()
    if page is None:
        raise HTTPException(status_code=404, detail="Página no encontrada")

    revision = await session.get(WikiPageRevision, revision_id)
    if revision is None or revision.wiki_page_id != page.id:
        raise HTTPException(status_code=404, detail="Revisión no encontrada")

    # Snapshot current content before restoring.
    snapshot = WikiPageRevision(
        wiki_page_id=page.id,
        content_markdown=page.content_markdown,
        is_ai_generated=page.is_ai_generated,
        created_at=datetime.now(timezone.utc),
    )
    session.add(snapshot)

    page.content_markdown = revision.content_markdown
    page.is_ai_generated = revision.is_ai_generated
    await session.commit()
    await session.refresh(page)
    return page


# ---------------------------------------------------------------------------
# Export and dependency graph
# ---------------------------------------------------------------------------

@router.get("/repositories/{repo_id}/dependency-graph", response_model=DependencyGraphResponse)
async def get_dependency_graph(repo_id: int, session: AsyncSession = Depends(get_session)):
    repo = await session.get(Repository, repo_id)
    if repo is None:
        raise HTTPException(status_code=404, detail="Repositorio no encontrado")
    graph = repo.dependency_graph or {"nodes": [], "edges": []}
    return DependencyGraphResponse(nodes=graph.get("nodes", []), edges=graph.get("edges", []))


@router.get("/repositories/{repo_id}/export")
async def export_wiki(repo_id: int, session: AsyncSession = Depends(get_session)):
    """Descarga el wiki completo como un único archivo .md autocontenido."""
    repo = await session.get(Repository, repo_id)
    if repo is None:
        raise HTTPException(status_code=404, detail="Repositorio no encontrado")

    pages = (
        await session.execute(select(WikiPage).where(WikiPage.repository_id == repo_id).order_by(WikiPage.order))
    ).scalars().all()
    if not pages:
        raise HTTPException(status_code=400, detail="Este repositorio aún no tiene wiki generado")

    markdown = export_wiki_to_markdown(repo, pages)
    filename = f"{repo.project_path.replace('/', '-')}-wiki.md"

    return Response(
        content=markdown,
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/repositories/{repo_id}/export/html")
async def export_wiki_html(repo_id: int, session: AsyncSession = Depends(get_session)):
    """Descarga el wiki completo como un único archivo HTML autocontenido con estilos integrados."""
    from app.services.wiki_exporter import export_wiki_to_html

    repo = await session.get(Repository, repo_id)
    if repo is None:
        raise HTTPException(status_code=404, detail="Repositorio no encontrado")

    pages = (
        await session.execute(select(WikiPage).where(WikiPage.repository_id == repo_id).order_by(WikiPage.order))
    ).scalars().all()
    if not pages:
        raise HTTPException(status_code=400, detail="Este repositorio aún no tiene wiki generado")

    html_content = export_wiki_to_html(repo, pages)
    filename = f"{repo.project_path.replace('/', '-')}-wiki.html"

    return Response(
        content=html_content,
        media_type="text/html; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/repositories/{repo_id}/wiki/search", response_model=list[WikiTextSearchResult])
async def search_wiki_text(
    repo_id: int,
    q: str = Query(..., min_length=1, max_length=200, description="Texto a buscar en el wiki"),
    session: AsyncSession = Depends(get_session),
):
    """Full-text search across all wiki pages for this repository.

    Uses SQLite FTS5 when available, with a LIKE fallback for safety.
    Returns up to 20 results with a short excerpt highlighting the match position.
    """
    repo = await session.get(Repository, repo_id)
    if repo is None:
        raise HTTPException(status_code=404, detail="Repositorio no encontrado")

    try:
        rows = (await session.execute(
            text(
                "SELECT p.slug, p.title, p.content_markdown "
                "FROM wiki_pages_fts fts "
                "JOIN wiki_pages p ON p.id = fts.rowid "
                "WHERE p.repository_id = :repo_id AND wiki_pages_fts MATCH :q "
                "ORDER BY rank LIMIT 20"
            ),
            {"repo_id": repo_id, "q": q},
        )).all()
    except Exception:
        # FTS table not yet populated or query error — fall back to LIKE
        like_term = f"%{q}%"
        rows = (await session.execute(
            select(WikiPage.slug, WikiPage.title, WikiPage.content_markdown)
            .where(
                WikiPage.repository_id == repo_id,
                or_(WikiPage.title.ilike(like_term), WikiPage.content_markdown.ilike(like_term)),
            )
            .order_by(WikiPage.order)
            .limit(20)
        )).all()

    return [
        WikiTextSearchResult(slug=row.slug, title=row.title, excerpt=_extract_excerpt(row.content_markdown, q))
        for row in rows
    ]


def _extract_excerpt(content: str, query: str, context: int = 120) -> str:
    """Return a short excerpt around the first match of *query* in *content*."""
    idx = content.lower().find(query.lower())
    if idx == -1:
        return content[:200] + ("…" if len(content) > 200 else "")
    start = max(0, idx - 80)
    end = min(len(content), idx + len(query) + context)
    excerpt = content[start:end]
    if start > 0:
        excerpt = "…" + excerpt
    if end < len(content):
        excerpt = excerpt + "…"
    return excerpt


@router.patch("/repositories/{repo_id}/webhook-secret")
async def set_repo_webhook_secret(
    repo_id: int,
    payload: RepoWebhookSecretUpdate,
    session: AsyncSession = Depends(get_session),
):
    """Set (or clear) the per-repo webhook secret used to validate GitLab push events.

    When set, overrides the global GITLAB_WEBHOOK_SECRET for this specific repo,
    allowing each repo to have its own GitLab webhook configured with a unique secret.
    """
    repo = await session.get(Repository, repo_id)
    if repo is None:
        raise HTTPException(status_code=404, detail="Repositorio no encontrado")
    repo.webhook_secret = payload.webhook_secret
    await session.commit()
    return {"ok": True, "webhook_secret_set": bool(payload.webhook_secret)}


# ---------------------------------------------------------------------------
# Push wiki to GitLab's native wiki
# ---------------------------------------------------------------------------

@router.post("/repositories/{repo_id}/push-to-gitlab-wiki", response_model=PushToGitLabWikiResponse)
async def push_to_gitlab_wiki(
    repo_id: int,
    payload: PushToGitLabWikiRequest,
    session: AsyncSession = Depends(get_session),
):
    """Pushes all generated wiki pages to the repository's native GitLab wiki.

    Creates or updates each page via the GitLab Wikis API
    (PUT /api/v4/projects/{id}/wikis/{slug}, POST to create).
    Requires the PAT to have api or write_wiki scope.
    """
    repo = await session.get(Repository, repo_id)
    if repo is None:
        raise HTTPException(status_code=404, detail="Repositorio no encontrado")

    pages = (
        await session.execute(select(WikiPage).where(WikiPage.repository_id == repo_id).order_by(WikiPage.order))
    ).scalars().all()
    if not pages:
        raise HTTPException(status_code=400, detail="Este repositorio aún no tiene wiki generado")

    if not repo.project_id:
        raise HTTPException(status_code=400, detail="El repositorio no tiene project_id guardado; re-indexa primero.")

    pushed = 0
    errors: list[str] = []

    async with GitLabClient(base_url=repo.gitlab_url, private_token=payload.private_token) as client:
        for page in pages:
            try:
                await client.create_or_update_wiki_page(
                    project_id=repo.project_id,
                    slug=page.slug,
                    title=page.title,
                    content=page.content_markdown,
                )
                pushed += 1
            except GitLabAuthError as e:
                raise HTTPException(status_code=403, detail=f"Auth error pushing to GitLab wiki: {e}")
            except Exception as e:
                logger.warning("Failed to push page '%s' to GitLab wiki: %s", page.slug, e)
                errors.append(f"{page.slug}: {e}")

    return PushToGitLabWikiResponse(ok=True, pages_pushed=pushed, errors=errors)


# ---------------------------------------------------------------------------
# Semantic code search
# ---------------------------------------------------------------------------

@router.post("/repositories/{repo_id}/search", response_model=CodeSearchResponse)
async def search_code(repo_id: int, payload: CodeSearchRequest, session: AsyncSession = Depends(get_session)):
    """Búsqueda semántica directa sobre el código indexado en Qdrant, SIN pasar por el LLM."""
    repo = await session.get(Repository, repo_id)
    if repo is None:
        raise HTTPException(status_code=404, detail="Repositorio no encontrado")
    if not repo.indexed_in_qdrant:
        raise HTTPException(
            status_code=400,
            detail="Este repositorio no tiene el código indexado en Qdrant (búsqueda semántica no disponible).",
        )

    try:
        query_vector = await get_embedding_client().embed_one(payload.query)
    except EmbeddingError as e:
        raise HTTPException(status_code=502, detail=f"No se pudo generar el embedding de la búsqueda: {e}")

    vector_store = VectorStore(repo_id)
    try:
        chunks = await vector_store.search(query_vector, top_k=payload.top_k)
    finally:
        await vector_store.close()

    results = [
        CodeSource(file_path=c.file_path, start_line=c.start_line, end_line=c.end_line,
                   content=c.content, score=c.score)
        for c in chunks
    ]
    return CodeSearchResponse(results=results)


# ---------------------------------------------------------------------------
# RAG chat (non-streaming and streaming)
# ---------------------------------------------------------------------------

@router.post("/repositories/{repo_id}/chat", response_model=ChatResponse)
@limiter.limit(settings.rate_limit_chat)
async def chat_with_repo(
    request: Request,
    repo_id: int,
    payload: ChatRequest,
    session: AsyncSession = Depends(get_session),
    wiki_generator: WikiGenerator = Depends(_get_wiki_generator),
):
    """Responde una pregunta libre sobre el repositorio usando RAG."""
    repo = await session.get(Repository, repo_id)
    if repo is None:
        raise HTTPException(status_code=404, detail="Repositorio no encontrado")

    # Check DB-backed cache first.
    cached = await _db_cache_get(session, repo_id, payload.question)
    if cached is not None:
        cached_answer, cached_sources = cached
        return ChatResponse(answer=cached_answer, sources=cached_sources)

    page_rows = (
        await session.execute(
            select(WikiPage.title, WikiPage.content_markdown)
            .where(WikiPage.repository_id == repo_id)
            .order_by(WikiPage.order)
        )
    ).all()
    if not page_rows:
        raise HTTPException(status_code=400, detail="Este repositorio aún no tiene wiki generado")

    wiki_summary = "\n\n".join(f"## {title}\n{content[:500]}" for title, content in page_rows)

    retrieved_chunks = []
    if repo.indexed_in_qdrant:
        query_vector = None
        try:
            query_vector = await get_embedding_client().embed_one(payload.question)
        except EmbeddingError as e:
            logger.warning("Embedding failed for chat query, falling back to wiki-only context: %s", e)

        if query_vector is not None:
            vector_store = VectorStore(repo_id)
            try:
                retrieved_chunks = await vector_store.search(query_vector)
            except Exception:
                logger.warning("Qdrant search failed for repo %s, falling back to wiki-only context", repo_id, exc_info=True)
            finally:
                await vector_store.close()

    try:
        answer = await wiki_generator.answer_question_rag(
            project_name=repo.name,
            question=payload.question,
            retrieved_chunks=retrieved_chunks,
            wiki_summary=wiki_summary,
        )
    except openai.AuthenticationError:
        raise HTTPException(status_code=502, detail="No se pudo autenticar contra el servidor del LLM configurado.")
    except openai.APIConnectionError as e:
        raise HTTPException(status_code=502, detail=f"No se pudo conectar con el servidor del LLM en OPENAI_URL: {e}")
    except openai.APIError as e:
        raise HTTPException(status_code=502, detail=f"Error al consultar el LLM: {e}")

    sources = [
        CodeSource(
            file_path=c.file_path, start_line=c.start_line, end_line=c.end_line,
            content=c.content, score=c.score,
        )
        for c in retrieved_chunks
    ]

    sources_dicts = [s.model_dump() for s in sources]
    await _db_cache_set(session, repo_id, payload.question, answer, sources_dicts)
    return ChatResponse(answer=answer, sources=sources)


@router.post("/repositories/{repo_id}/chat/stream")
@limiter.limit(settings.rate_limit_chat)
async def stream_chat_with_repo(
    request: Request,
    repo_id: int,
    payload: ChatRequest,
    session: AsyncSession = Depends(get_session),
    wiki_generator: WikiGenerator = Depends(_get_wiki_generator),
):
    """SSE endpoint that streams LLM answer tokens as they arrive.

    Events:
    - ``event: sources`` — JSON array of CodeSource objects (sent before tokens)
    - ``data: {"token": "..."}`` — incremental answer token
    - ``event: done``  — stream finished
    - ``event: error`` — JSON with ``message`` field
    """
    repo = await session.get(Repository, repo_id)
    if repo is None:
        raise HTTPException(status_code=404, detail="Repositorio no encontrado")

    page_rows = (
        await session.execute(
            select(WikiPage.title, WikiPage.content_markdown)
            .where(WikiPage.repository_id == repo_id)
            .order_by(WikiPage.order)
        )
    ).all()
    if not page_rows:
        raise HTTPException(status_code=400, detail="Este repositorio aún no tiene wiki generado")

    wiki_summary = "\n\n".join(f"## {title}\n{content[:500]}" for title, content in page_rows)

    retrieved_chunks = []
    if repo.indexed_in_qdrant:
        query_vector = None
        try:
            query_vector = await get_embedding_client().embed_one(payload.question)
        except EmbeddingError as e:
            logger.warning("Embedding failed for streaming chat, falling back to wiki-only: %s", e)

        if query_vector is not None:
            vector_store = VectorStore(repo_id)
            try:
                retrieved_chunks = await vector_store.search(query_vector)
            except Exception:
                logger.warning("Qdrant search failed for streaming chat (repo %s)", repo_id, exc_info=True)
            finally:
                await vector_store.close()

    sources = [
        CodeSource(
            file_path=c.file_path, start_line=c.start_line, end_line=c.end_line,
            content=c.content, score=c.score,
        )
        for c in retrieved_chunks
    ]

    repo_name = repo.name
    question = payload.question

    async def event_generator():
        if sources:
            yield f"event: sources\ndata: {json.dumps([s.model_dump() for s in sources])}\n\n"
        try:
            async for token in wiki_generator.stream_answer_question_rag(
                project_name=repo_name,
                question=question,
                retrieved_chunks=retrieved_chunks,
                wiki_summary=wiki_summary,
            ):
                yield f"data: {json.dumps({'token': token})}\n\n"
        except openai.AuthenticationError:
            yield f"event: error\ndata: {json.dumps({'message': 'LLM authentication error'})}\n\n"
        except (openai.APIConnectionError, openai.APIError) as exc:
            yield f"event: error\ndata: {json.dumps({'message': str(exc)})}\n\n"
        finally:
            yield "event: done\ndata: {}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# GitLab webhooks
# ---------------------------------------------------------------------------

@router.post("/webhooks/gitlab", status_code=202)
async def gitlab_webhook(
    request: Request,
    payload: GitLabWebhookPayload,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
):
    """Receives GitLab push webhooks and triggers a re-index of the affected repository.

    Token validation order: per-repo webhook_secret → global GITLAB_WEBHOOK_SECRET.
    If neither is set, the endpoint accepts unauthenticated requests (dev only).
    """
    project_path_early = payload.project.get("path_with_namespace", "")
    repo_early = None
    if project_path_early:
        repo_early = (
            await session.execute(
                select(Repository).where(Repository.project_path == project_path_early).limit(1)
            )
        ).scalars().first()

    # Per-repo secret takes precedence over the global one.
    effective_secret = (repo_early.webhook_secret if repo_early and repo_early.webhook_secret
                        else settings.gitlab_webhook_secret)
    if effective_secret:
        token = request.headers.get("x-gitlab-token", "")
        if not hmac.compare_digest(token, effective_secret):
            raise HTTPException(status_code=403, detail="Invalid webhook token")

    if payload.object_kind != "push":
        return {"ok": True, "skipped": True, "reason": "not a push event"}

    project_path = payload.project.get("path_with_namespace", "")
    if not project_path:
        raise HTTPException(status_code=422, detail="Missing project.path_with_namespace in payload")

    repo = repo_early or (
        await session.execute(
            select(Repository).where(Repository.project_path == project_path).limit(1)
        )
    ).scalars().first()

    if repo is None:
        return {"ok": True, "skipped": True, "reason": "repo not indexed"}

    if not settings.gitlab_default_token:
        logger.warning("Webhook for '%s' received but GITLAB_DEFAULT_TOKEN is not configured", project_path)
        return {"ok": True, "skipped": True, "reason": "no default token configured"}

    active_job = (
        await session.execute(
            select(IndexJob)
            .where(
                IndexJob.repository_id == repo.id,
                IndexJob.status.notin_([JobStatus.DONE.value, JobStatus.FAILED.value]),
            )
            .limit(1)
        )
    ).scalars().first()
    if active_job:
        return {"ok": True, "skipped": True, "reason": "indexing already in progress", "job_id": active_job.id}

    await _db_cache_invalidate_repo(session, repo.id)
    job = IndexJob(repository_id=repo.id, status=JobStatus.PENDING.value, progress=0,
                   current_step="En cola (disparado por webhook de GitLab)...")
    session.add(job)
    await session.commit()
    await session.refresh(job)

    background_tasks.add_task(
        run_index_job, job.id, repo.gitlab_url, repo.project_path,
        settings.gitlab_default_token, None, False,
    )
    return {"ok": True, "job_id": job.id}


# ---------------------------------------------------------------------------
# Delete repository
# ---------------------------------------------------------------------------

@router.delete("/repositories/{repo_id}")
async def delete_repository(repo_id: int, session: AsyncSession = Depends(get_session)):
    repo = await session.get(Repository, repo_id)
    if repo is None:
        raise HTTPException(status_code=404, detail="Repositorio no encontrado")
    await session.delete(repo)
    await session.commit()
    if repo.indexed_in_qdrant:
        vector_store = VectorStore(repo_id)
        try:
            await vector_store.drop_collection()
        finally:
            await vector_store.close()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Server configuration (read-only)
# ---------------------------------------------------------------------------

@router.get("/config")
async def get_server_config():
    """Returns non-sensitive server configuration so the UI can display active settings."""
    return {
        "llm_model": settings.openai_chat_model,
        "wiki_language": settings.wiki_language,
        "max_files_to_index": settings.max_files_to_index,
        "rag_top_k": settings.rag_top_k,
        "embedding_dimensions": settings.embedding_dimensions,
    }


# ---------------------------------------------------------------------------
# Group helpers
# ---------------------------------------------------------------------------

async def _expand_with_external_deps(
    session: AsyncSession,
    group: GitLabGroup,
    member_ids: list[int],
) -> list[int]:
    """Return member_ids expanded with externally-referenced repos.

    Reads "external" edges from the group's stored cross_repo_graph and adds
    the IDs of those repos (which are indexed in Qdrant but live in other groups)
    so that search/chat queries automatically include cross-group dependencies.
    """
    graph = group.cross_repo_graph or {}
    external_names = {
        e["target"]
        for e in graph.get("edges", [])
        if e.get("external") and e.get("target")
    }
    if not external_names:
        return member_ids

    external_ids = list(
        (
            await session.execute(
                select(Repository.id).where(
                    Repository.name.in_(external_names),
                    Repository.indexed_in_qdrant == True,  # noqa: E712
                )
            )
        ).scalars().all()
    )
    return list(set(member_ids) | set(external_ids))


# ---------------------------------------------------------------------------
# Group indexing
# ---------------------------------------------------------------------------

@router.post("/groups/index", response_model=GroupJobResponse)
@limiter.limit(settings.rate_limit_index)
async def index_group(
    request: Request,
    payload: IndexGroupRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
):
    """Discovers and indexes all repositories in a GitLab group."""
    # Find or create the GitLabGroup record.
    existing_group = (
        await session.execute(
            select(GitLabGroup).where(
                GitLabGroup.gitlab_url == payload.gitlab_url,
                GitLabGroup.group_path == payload.group_path,
            )
        )
    ).scalars().first()

    if existing_group is None:
        group = GitLabGroup(
            gitlab_url=payload.gitlab_url,
            group_path=payload.group_path,
            name=payload.group_path.split("/")[-1],
        )
        session.add(group)
        await session.commit()
        await session.refresh(group)
    else:
        group = existing_group
        # Check for an active job.
        active_job = (
            await session.execute(
                select(GroupIndexJob).where(
                    GroupIndexJob.group_id == group.id,
                    GroupIndexJob.status.notin_([
                        GroupIndexStatus.DONE.value, GroupIndexStatus.FAILED.value
                    ]),
                ).limit(1)
            )
        ).scalars().first()
        if active_job:
            raise HTTPException(
                status_code=409,
                detail=f"Ya hay un job de grupo activo (job_id={active_job.id}). Espera a que termine.",
            )

    job = GroupIndexJob(
        group_id=group.id,
        status=GroupIndexStatus.PENDING.value,
        current_step="En cola...",
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)

    background_tasks.add_task(
        run_group_index_job,
        job.id,
        payload.gitlab_url,
        payload.group_path,
        payload.private_token,
        payload.force_reindex,
        payload.include_subgroups,
    )

    return GroupJobResponse(
        job_id=job.id,
        group_id=group.id,
        status=job.status,
        total_repos=job.total_repos,
        completed_repos=job.completed_repos,
        failed_repos=job.failed_repos,
        current_step=job.current_step,
    )


@router.get("/groups", response_model=list[GroupSummary])
async def list_groups(
    session: AsyncSession = Depends(get_session),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    groups = (
        await session.execute(
            select(GitLabGroup).order_by(GitLabGroup.updated_at.desc()).offset(offset).limit(limit)
        )
    ).scalars().all()
    return groups


@router.get("/groups/{group_id}", response_model=GroupDetail)
async def get_group(group_id: int, session: AsyncSession = Depends(get_session)):
    group = await session.get(GitLabGroup, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Grupo no encontrado")
    repos = (
        await session.execute(
            select(Repository)
            .join(GroupMembership, GroupMembership.repository_id == Repository.id)
            .where(GroupMembership.group_id == group_id)
            .order_by(Repository.name)
        )
    ).scalars().all()
    return GroupDetail(
        id=group.id,
        gitlab_url=group.gitlab_url,
        group_path=group.group_path,
        gitlab_group_id=group.gitlab_group_id,
        name=group.name,
        description=group.description,
        updated_at=group.updated_at,
        overview_markdown=group.overview_markdown,
        repositories=repos,
        cross_repo_graph=group.cross_repo_graph or {},
    )


@router.get("/groups/{group_id}/jobs/{job_id}", response_model=GroupJobResponse)
async def get_group_job(group_id: int, job_id: int, session: AsyncSession = Depends(get_session)):
    job = await session.get(GroupIndexJob, job_id)
    if job is None or job.group_id != group_id:
        raise HTTPException(status_code=404, detail="Job no encontrado")
    rs_rows = (
        await session.execute(
            select(GroupRepoStatus).where(GroupRepoStatus.group_job_id == job_id)
        )
    ).scalars().all()
    return GroupJobResponse(
        job_id=job.id,
        group_id=job.group_id,
        status=job.status,
        total_repos=job.total_repos,
        completed_repos=job.completed_repos,
        failed_repos=job.failed_repos,
        current_step=job.current_step,
        error_summary=job.error_summary,
        repo_statuses=[
            GroupRepoStatusResponse(
                id=rs.id,
                project_path=rs.project_path,
                repository_id=rs.repository_id,
                status=rs.status,
                error_message=rs.error_message,
            )
            for rs in rs_rows
        ],
    )


@router.get("/groups/{group_id}/jobs/{job_id}/stream")
async def stream_group_job(group_id: int, job_id: int):
    """SSE stream of GroupIndexJob progress until it reaches a terminal state."""
    async def event_generator():
        last_key: tuple | None = None
        while True:
            async with AsyncSessionLocal() as session:
                job = await session.get(GroupIndexJob, job_id)
                if job is None or job.group_id != group_id:
                    yield f"data: {json.dumps({'error': 'Job no encontrado'})}\n\n"
                    return

                rs_rows = (
                    await session.execute(
                        select(GroupRepoStatus).where(GroupRepoStatus.group_job_id == job_id)
                    )
                ).scalars().all()

                current_key = (job.status, job.completed_repos, job.failed_repos, job.current_step)
                if current_key != last_key:
                    last_key = current_key
                    response_obj = GroupJobResponse(
                        job_id=job.id,
                        group_id=job.group_id,
                        status=job.status,
                        total_repos=job.total_repos,
                        completed_repos=job.completed_repos,
                        failed_repos=job.failed_repos,
                        current_step=job.current_step,
                        error_summary=job.error_summary,
                        repo_statuses=[
                            GroupRepoStatusResponse(
                                id=rs.id,
                                project_path=rs.project_path,
                                repository_id=rs.repository_id,
                                status=rs.status,
                                error_message=rs.error_message,
                            )
                            for rs in rs_rows
                        ],
                    )
                    yield f"data: {response_obj.model_dump_json()}\n\n"

                terminal = job.status in (GroupIndexStatus.DONE.value, GroupIndexStatus.FAILED.value)

            if terminal:
                return
            await asyncio.sleep(1.0)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/groups/{group_id}/wiki")
async def get_group_wiki(group_id: int, session: AsyncSession = Depends(get_session)):
    """Returns the group overview wiki markdown."""
    group = await session.get(GitLabGroup, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Grupo no encontrado")
    if not group.overview_markdown:
        raise HTTPException(status_code=400, detail="El grupo aún no tiene overview generado")
    return {"overview_markdown": group.overview_markdown}


@router.post("/groups/{group_id}/search", response_model=CrossRepoSearchResponse)
async def cross_repo_search(
    group_id: int,
    payload: CrossRepoSearchRequest,
    session: AsyncSession = Depends(get_session),
):
    """Semantic search across all repositories in the group."""
    group = await session.get(GitLabGroup, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Grupo no encontrado")

    if payload.repo_ids:
        repo_ids = payload.repo_ids
    else:
        member_ids = list(
            (
                await session.execute(
                    select(Repository.id)
                    .join(GroupMembership, GroupMembership.repository_id == Repository.id)
                    .where(GroupMembership.group_id == group_id)
                )
            ).scalars().all()
        )
        expanded_ids = await _expand_with_external_deps(session, group, member_ids)
        repo_ids = list(
            (
                await session.execute(
                    select(Repository.id).where(
                        Repository.id.in_(expanded_ids),
                        Repository.indexed_in_qdrant == True,  # noqa: E712
                    )
                )
            ).scalars().all()
        )

    if not repo_ids:
        raise HTTPException(status_code=400, detail="No hay repositorios con RAG activo en este grupo")

    # Fetch repo metadata for result enrichment.
    repos_meta = {
        r.id: r
        for r in (
            await session.execute(select(Repository).where(Repository.id.in_(repo_ids)))
        ).scalars().all()
    }

    try:
        from app.services.embedding_client import EmbeddingError
        hits = await search_across_repos(
            query=payload.query,
            repo_ids=repo_ids,
            top_k_per_repo=max(3, payload.top_k // max(len(repo_ids), 1) + 2),
            top_k_total=payload.top_k,
        )
    except EmbeddingError as exc:
        raise HTTPException(status_code=502, detail=f"No se pudo generar el embedding: {exc}")

    results = [
        CrossRepoSearchResult(
            repository_id=rid,
            repository_name=repos_meta[rid].name if rid in repos_meta else str(rid),
            repository_path=repos_meta[rid].project_path if rid in repos_meta else "",
            file_path=chunk.file_path,
            start_line=chunk.start_line,
            end_line=chunk.end_line,
            content=chunk.content,
            score=chunk.score,
        )
        for rid, chunk in hits
    ]
    return CrossRepoSearchResponse(results=results)


@router.post("/groups/{group_id}/chat", response_model=ChatResponse)
@limiter.limit(settings.rate_limit_chat)
async def group_chat(
    request: Request,
    group_id: int,
    payload: ChatRequest,
    session: AsyncSession = Depends(get_session),
    wiki_generator: WikiGenerator = Depends(_get_wiki_generator),
):
    """RAG-powered chat answering questions across all repositories in the group."""
    group = await session.get(GitLabGroup, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Grupo no encontrado")

    member_repo_ids = list(
        (
            await session.execute(
                select(Repository.id)
                .join(GroupMembership, GroupMembership.repository_id == Repository.id)
                .where(GroupMembership.group_id == group_id)
            )
        ).scalars().all()
    )
    all_repo_ids = await _expand_with_external_deps(session, group, member_repo_ids)
    qdrant_repo_ids = list(
        (
            await session.execute(
                select(Repository.id).where(
                    Repository.id.in_(all_repo_ids),
                    Repository.indexed_in_qdrant == True,  # noqa: E712
                )
            )
        ).scalars().all()
    )
    repo_names = list(
        (
            await session.execute(
                select(Repository.name).where(Repository.id.in_(all_repo_ids))
            )
        ).scalars().all()
    )

    retrieved_chunks = []
    if qdrant_repo_ids:
        try:
            from app.services.embedding_client import EmbeddingError
            hits = await search_across_repos(
                query=payload.question,
                repo_ids=qdrant_repo_ids,
                top_k_per_repo=3,
                top_k_total=8,
            )
            retrieved_chunks = [chunk for _, chunk in hits]
        except Exception:
            logger.warning("Cross-repo search failed for group %d chat", group_id, exc_info=True)

    try:
        answer = await wiki_generator.answer_group_question_rag(
            group_name=group.name,
            repo_names=repo_names,
            question=payload.question,
            retrieved_chunks=retrieved_chunks,
            group_wiki_summary=group.overview_markdown[:2000] if group.overview_markdown else "",
        )
    except openai.AuthenticationError:
        raise HTTPException(status_code=502, detail="Error de autenticación con el LLM.")
    except openai.APIConnectionError as exc:
        raise HTTPException(status_code=502, detail=f"No se pudo conectar con el LLM: {exc}")
    except openai.APIError as exc:
        raise HTTPException(status_code=502, detail=f"Error del LLM: {exc}")

    sources = [
        CodeSource(
            file_path=c.file_path, start_line=c.start_line, end_line=c.end_line,
            content=c.content, score=c.score,
        )
        for c in retrieved_chunks
    ]
    return ChatResponse(answer=answer, sources=sources)


@router.post("/groups/{group_id}/chat/stream")
@limiter.limit(settings.rate_limit_chat)
async def stream_group_chat(
    request: Request,
    group_id: int,
    payload: ChatRequest,
    session: AsyncSession = Depends(get_session),
    wiki_generator: WikiGenerator = Depends(_get_wiki_generator),
):
    """Streaming SSE version of group RAG chat."""
    group = await session.get(GitLabGroup, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Grupo no encontrado")

    member_ids_stream = list(
        (
            await session.execute(
                select(Repository.id)
                .join(GroupMembership, GroupMembership.repository_id == Repository.id)
                .where(GroupMembership.group_id == group_id)
            )
        ).scalars().all()
    )
    all_ids_stream = await _expand_with_external_deps(session, group, member_ids_stream)
    qdrant_repo_ids = list(
        (
            await session.execute(
                select(Repository.id).where(
                    Repository.id.in_(all_ids_stream),
                    Repository.indexed_in_qdrant == True,  # noqa: E712
                )
            )
        ).scalars().all()
    )
    repo_names = list(
        (
            await session.execute(
                select(Repository.name).where(Repository.id.in_(all_ids_stream))
            )
        ).scalars().all()
    )

    retrieved_chunks = []
    if qdrant_repo_ids:
        try:
            hits = await search_across_repos(
                query=payload.question,
                repo_ids=qdrant_repo_ids,
                top_k_per_repo=3,
                top_k_total=8,
            )
            retrieved_chunks = [chunk for _, chunk in hits]
        except Exception:
            logger.warning("Cross-repo search failed for group %d streaming chat", group_id, exc_info=True)

    sources = [
        CodeSource(
            file_path=c.file_path, start_line=c.start_line, end_line=c.end_line,
            content=c.content, score=c.score,
        )
        for c in retrieved_chunks
    ]

    group_name = group.name
    group_wiki_summary = group.overview_markdown[:2000] if group.overview_markdown else ""
    question = payload.question

    async def event_generator():
        if sources:
            yield f"event: sources\ndata: {json.dumps([s.model_dump() for s in sources])}\n\n"
        try:
            async for token in wiki_generator.stream_answer_group_question_rag(
                group_name=group_name,
                repo_names=repo_names,
                question=question,
                retrieved_chunks=retrieved_chunks,
                group_wiki_summary=group_wiki_summary,
            ):
                yield f"data: {json.dumps({'token': token})}\n\n"
        except openai.AuthenticationError:
            yield f"event: error\ndata: {json.dumps({'message': 'LLM authentication error'})}\n\n"
        except (openai.APIConnectionError, openai.APIError) as exc:
            yield f"event: error\ndata: {json.dumps({'message': str(exc)})}\n\n"
        finally:
            yield "event: done\ndata: {}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/groups/{group_id}/dependency-graph", response_model=DependencyGraphResponse)
async def get_group_dependency_graph(group_id: int, session: AsyncSession = Depends(get_session)):
    group = await session.get(GitLabGroup, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Grupo no encontrado")
    graph = group.cross_repo_graph or {"nodes": [], "edges": []}
    return DependencyGraphResponse(nodes=graph.get("nodes", []), edges=graph.get("edges", []))


@router.delete("/groups/{group_id}")
async def delete_group(group_id: int, session: AsyncSession = Depends(get_session)):
    """Deletes the group record and its memberships. Repositories themselves are kept."""
    group = await session.get(GitLabGroup, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Grupo no encontrado")
    # GroupMembership rows are CASCADE-deleted by the DB FK.
    await session.delete(group)
    await session.commit()
    return {"ok": True}
