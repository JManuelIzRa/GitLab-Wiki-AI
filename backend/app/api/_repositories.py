"""Repository, wiki, job, webhook, and utility endpoints."""
from __future__ import annotations

import asyncio
import hmac
import json
import logging
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api._cache import db_cache_invalidate
from app.core.config import settings
from app.core.rate_limit import limiter
from app.db.session import AsyncSessionLocal, get_session
from app.models.db_models import (
    IndexJob, JobStatus, Repository, WikiPage, WikiPageRevision,
)
from app.models.schemas import (
    BranchListRequest, DependencyGraphResponse, GitLabWebhookPayload,
    IndexJobResponse, IndexRepositoryRequest, PushToGitLabWikiRequest,
    PushToGitLabWikiResponse, RepoGitLabTokenUpdate, RepoSystemPromptUpdate,
    RepoWebhookSecretUpdate, RepositorySummary, WikiPageDetail,
    WikiPageUpdate, WikiRevisionResponse, WikiStructureResponse, WikiTextSearchResult,
)
from app.services.gitlab_client import GitLabAuthError, GitLabClient, GitLabNotFoundError
from app.services.indexer import run_index_job
from app.services.vector_store import VectorStore
from app.services.wiki_exporter import export_wiki_to_markdown

logger = logging.getLogger(__name__)

router = APIRouter()

# Per-repo asyncio lock to prevent concurrent indexing of the same repository.
_index_locks: dict[tuple[str, str], asyncio.Lock] = defaultdict(asyncio.Lock)


def _repo_lock(gitlab_url: str, project_path: str) -> asyncio.Lock:
    return _index_locks[(gitlab_url.rstrip("/"), project_path.strip("/"))]


def _extract_excerpt(content: str, query: str, context: int = 120) -> str:
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


# ---------------------------------------------------------------------------
# Indexing & jobs
# ---------------------------------------------------------------------------

@router.post("/repositories/index", response_model=IndexJobResponse)
@limiter.limit(settings.rate_limit_index)
async def index_repository(
    request: Request,
    payload: IndexRepositoryRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
):
    """Creates (or reuses) a Repository record and launches an IndexJob in background."""
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
                    detail=f"Ya hay un job de indexado activo (job_id={active_job.id}) para este repositorio.",
                )

        await db_cache_invalidate(session, repo.id)

        job = IndexJob(
            repository_id=repo.id, status=JobStatus.PENDING.value,
            progress=0, current_step="En cola...",
        )
        session.add(job)
        await session.commit()
        await session.refresh(job)

    background_tasks.add_task(
        run_index_job, job.id, payload.gitlab_url, payload.project_path,
        payload.private_token, payload.branch, payload.force_reindex,
    )

    return IndexJobResponse(
        job_id=job.id, repository_id=repo.id, status=job.status,
        progress=job.progress, current_step=job.current_step,
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
    """SSE stream of job progress until it reaches a terminal state."""
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
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    repos = (
        await session.execute(
            select(Repository).order_by(Repository.updated_at.desc()).offset(offset).limit(limit)
        )
    ).scalars().all()
    return [RepositorySummary.from_orm_with_extras(r) for r in repos]


@router.get("/repositories/{repo_id}/wiki", response_model=WikiStructureResponse)
async def get_wiki_structure(repo_id: int, session: AsyncSession = Depends(get_session)):
    repo = await session.get(Repository, repo_id)
    if repo is None:
        raise HTTPException(status_code=404, detail="Repositorio no encontrado")
    pages = (
        await session.execute(
            select(WikiPage).where(WikiPage.repository_id == repo_id).order_by(WikiPage.order)
        )
    ).scalars().all()
    return WikiStructureResponse(repository=RepositorySummary.from_orm_with_extras(repo), pages=pages)


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
    """Saves a manual edit and snapshots the previous content as a revision."""
    page = (
        await session.execute(
            select(WikiPage).where(WikiPage.repository_id == repo_id, WikiPage.slug == slug)
        )
    ).scalar_one_or_none()
    if page is None:
        raise HTTPException(status_code=404, detail="Página no encontrada")

    revision = WikiPageRevision(
        wiki_page_id=page.id,
        content_markdown=page.content_markdown,
        is_ai_generated=page.is_ai_generated,
        created_at=datetime.now(timezone.utc),
    )
    session.add(revision)

    page.content_markdown = payload.content_markdown
    page.is_ai_generated = False
    await session.commit()
    await session.refresh(page)
    return page


# ---------------------------------------------------------------------------
# Wiki revisions
# ---------------------------------------------------------------------------

@router.get("/repositories/{repo_id}/wiki/{slug}/revisions", response_model=list[WikiRevisionResponse])
async def get_wiki_revisions(
    repo_id: int,
    slug: str,
    session: AsyncSession = Depends(get_session),
):
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


@router.post(
    "/repositories/{repo_id}/wiki/{slug}/revisions/{revision_id}/restore",
    response_model=WikiPageDetail,
)
async def restore_wiki_revision(
    repo_id: int,
    slug: str,
    revision_id: int,
    session: AsyncSession = Depends(get_session),
):
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
    repo = await session.get(Repository, repo_id)
    if repo is None:
        raise HTTPException(status_code=404, detail="Repositorio no encontrado")
    pages = (
        await session.execute(
            select(WikiPage).where(WikiPage.repository_id == repo_id).order_by(WikiPage.order)
        )
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
    from app.services.wiki_exporter import export_wiki_to_html

    repo = await session.get(Repository, repo_id)
    if repo is None:
        raise HTTPException(status_code=404, detail="Repositorio no encontrado")
    pages = (
        await session.execute(
            select(WikiPage).where(WikiPage.repository_id == repo_id).order_by(WikiPage.order)
        )
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
    q: str = Query(..., min_length=1, max_length=200),
    session: AsyncSession = Depends(get_session),
):
    """Full-text search across wiki pages using FTS5, with LIKE fallback."""
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


# ---------------------------------------------------------------------------
# Per-repo settings
# ---------------------------------------------------------------------------

@router.patch("/repositories/{repo_id}/webhook-secret")
async def set_repo_webhook_secret(
    repo_id: int,
    payload: RepoWebhookSecretUpdate,
    session: AsyncSession = Depends(get_session),
):
    repo = await session.get(Repository, repo_id)
    if repo is None:
        raise HTTPException(status_code=404, detail="Repositorio no encontrado")
    repo.webhook_secret = payload.webhook_secret
    await session.commit()
    return {"ok": True, "webhook_secret_set": bool(payload.webhook_secret)}


@router.patch("/repositories/{repo_id}/gitlab-token")
async def set_repo_gitlab_token(
    repo_id: int,
    payload: RepoGitLabTokenUpdate,
    session: AsyncSession = Depends(get_session),
):
    repo = await session.get(Repository, repo_id)
    if repo is None:
        raise HTTPException(status_code=404, detail="Repositorio no encontrado")
    repo.gitlab_token = payload.gitlab_token
    await session.commit()
    return {"ok": True, "token_set": bool(payload.gitlab_token)}


@router.patch("/repositories/{repo_id}/system-prompt")
async def set_repo_system_prompt(
    repo_id: int,
    payload: RepoSystemPromptUpdate,
    session: AsyncSession = Depends(get_session),
):
    repo = await session.get(Repository, repo_id)
    if repo is None:
        raise HTTPException(status_code=404, detail="Repositorio no encontrado")
    repo.system_prompt = payload.system_prompt
    await session.commit()
    return {"ok": True, "system_prompt_set": bool(payload.system_prompt)}


# ---------------------------------------------------------------------------
# GitLab utility proxy
# ---------------------------------------------------------------------------

@router.post("/gitlab/branches")
async def list_gitlab_branches(payload: BranchListRequest):
    """Proxy: list branches for a GitLab project."""
    try:
        async with GitLabClient(base_url=payload.gitlab_url, private_token=payload.private_token) as client:
            from urllib.parse import quote
            encoded = quote(payload.project_path, safe="")
            resp = await client._get(f"{client.api_url}/projects/{encoded}")
            project_id = str(resp.json()["id"])
            branches = await client.list_branches(project_id)
            return {"branches": branches}
    except GitLabAuthError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except GitLabNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"No se pudo conectar con GitLab: {exc}")


# ---------------------------------------------------------------------------
# Push to GitLab native wiki
# ---------------------------------------------------------------------------

@router.post("/repositories/{repo_id}/push-to-gitlab-wiki", response_model=PushToGitLabWikiResponse)
async def push_to_gitlab_wiki(
    repo_id: int,
    payload: PushToGitLabWikiRequest,
    session: AsyncSession = Depends(get_session),
):
    repo = await session.get(Repository, repo_id)
    if repo is None:
        raise HTTPException(status_code=404, detail="Repositorio no encontrado")
    pages = (
        await session.execute(
            select(WikiPage).where(WikiPage.repository_id == repo_id).order_by(WikiPage.order)
        )
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
# GitLab webhooks
# ---------------------------------------------------------------------------

@router.post("/webhooks/gitlab", status_code=202)
async def gitlab_webhook(
    request: Request,
    payload: GitLabWebhookPayload,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
):
    """Receives GitLab push webhooks and triggers a re-index."""
    project_path_early = payload.project.get("path_with_namespace", "")
    repo_early = None
    if project_path_early:
        repo_early = (
            await session.execute(
                select(Repository).where(Repository.project_path == project_path_early).limit(1)
            )
        ).scalars().first()

    effective_secret = (
        repo_early.webhook_secret
        if repo_early and repo_early.webhook_secret
        else settings.gitlab_webhook_secret
    )
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

    reindex_token = repo.gitlab_token or settings.gitlab_default_token
    if not reindex_token:
        logger.warning(
            "Webhook for '%s' received but no token available for re-indexing.", project_path,
        )
        return {"ok": True, "skipped": True, "reason": "no token configured for re-indexing"}

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

    await db_cache_invalidate(session, repo.id)
    job = IndexJob(
        repository_id=repo.id, status=JobStatus.PENDING.value, progress=0,
        current_step="En cola (disparado por webhook de GitLab)...",
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)

    background_tasks.add_task(
        run_index_job, job.id, repo.gitlab_url, repo.project_path, reindex_token, None, False,
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
    """Returns non-sensitive server configuration for the UI."""
    return {
        "llm_model": settings.openai_chat_model,
        "wiki_language": settings.wiki_language,
        "max_files_to_index": settings.max_files_to_index,
        "rag_top_k": settings.rag_top_k,
        "embedding_dimensions": settings.embedding_dimensions,
    }
