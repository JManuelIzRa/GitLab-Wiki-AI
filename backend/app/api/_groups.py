"""Group indexing and cross-repository chat/search endpoints."""
from __future__ import annotations

import asyncio
import json
import logging

import openai
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.rate_limit import limiter
from app.db.session import AsyncSessionLocal, get_session
from app.models.db_models import (
    GitLabGroup, GroupIndexJob, GroupIndexStatus, GroupMembership, GroupRepoStatus,
    Repository,
)
from app.models.schemas import (
    ChatRequest, ChatResponse, CodeSource, CrossRepoSearchRequest, CrossRepoSearchResponse,
    CrossRepoSearchResult, DependencyGraphResponse, GroupDetail, GroupJobResponse,
    GroupRepoStatusResponse, GroupSummary, IndexGroupRequest, RepositorySummary,
)
from app.services.cross_repo_search import search_across_repos
from app.services.group_indexer import run_group_index_job
from app.services.wiki_generator import WikiGenerator

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_wiki_generator(request: Request) -> WikiGenerator:
    return request.app.state.wiki_generator


async def _expand_with_external_deps(
    session: AsyncSession,
    group: GitLabGroup,
    member_ids: list[int],
) -> list[int]:
    """Return member_ids expanded with externally-referenced repos from the cross-repo graph."""
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
        repositories=[RepositorySummary.from_orm_with_extras(r) for r in repos],
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
    """SSE stream of GroupIndexJob progress until terminal state."""
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

    return CrossRepoSearchResponse(results=[
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
    ])


@router.post("/groups/{group_id}/chat", response_model=ChatResponse)
@limiter.limit(settings.rate_limit_chat)
async def group_chat(
    request: Request,
    group_id: int,
    payload: ChatRequest,
    session: AsyncSession = Depends(get_session),
    wiki_generator: WikiGenerator = Depends(_get_wiki_generator),
):
    """RAG chat answering questions across all repositories in the group."""
    group = await session.get(GitLabGroup, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Grupo no encontrado")

    member_ids = list(
        (
            await session.execute(
                select(Repository.id)
                .join(GroupMembership, GroupMembership.repository_id == Repository.id)
                .where(GroupMembership.group_id == group_id)
            )
        ).scalars().all()
    )
    all_repo_ids = await _expand_with_external_deps(session, group, member_ids)
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
            await session.execute(select(Repository.name).where(Repository.id.in_(all_repo_ids)))
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

    member_ids = list(
        (
            await session.execute(
                select(Repository.id)
                .join(GroupMembership, GroupMembership.repository_id == Repository.id)
                .where(GroupMembership.group_id == group_id)
            )
        ).scalars().all()
    )
    all_ids = await _expand_with_external_deps(session, group, member_ids)
    qdrant_repo_ids = list(
        (
            await session.execute(
                select(Repository.id).where(
                    Repository.id.in_(all_ids),
                    Repository.indexed_in_qdrant == True,  # noqa: E712
                )
            )
        ).scalars().all()
    )
    repo_names = list(
        (
            await session.execute(select(Repository.name).where(Repository.id.in_(all_ids)))
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
    await session.delete(group)
    await session.commit()
    return {"ok": True}
