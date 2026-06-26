"""
Orquestador del pipeline de indexado de grupos GitLab.

Flujo:
1. Descubrir todos los proyectos del grupo vía la API de GitLab.
2. Crear un GroupRepoStatus por proyecto.
3. Indexar cada repo usando run_index_job (con semáforo para limitar concurrencia).
4. Una vez completados todos, generar el overview del grupo y el grafo cross-repo.
5. Actualizar el GroupIndexJob a DONE.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.models.db_models import (
    GitLabGroup,
    GroupIndexJob,
    GroupIndexStatus,
    GroupMembership,
    GroupRepoStatus,
    IndexJob,
    JobStatus,
    Repository,
    WikiPage,
)
from app.services.cross_repo_graph import build_cross_repo_graph
from app.services.gitlab_client import GitLabAuthError, GitLabClient, GitLabNotFoundError, GitLabRateLimitError
from app.services.indexer import run_index_job
from app.services.wiki_generator import WikiGenerator

logger = logging.getLogger(__name__)


async def _update_group_job(
    session: AsyncSession,
    job: GroupIndexJob,
    *,
    status: str | None = None,
    step: str | None = None,
    error_summary: str | None = None,
    completed_delta: int = 0,
    failed_delta: int = 0,
) -> None:
    if status is not None:
        job.status = status
        if status in (GroupIndexStatus.DONE.value, GroupIndexStatus.FAILED.value):
            job.finished_at = datetime.now(timezone.utc)
    if step is not None:
        job.current_step = step
    if error_summary is not None:
        job.error_summary = (job.error_summary + "\n" + error_summary).strip()
    if completed_delta:
        job.completed_repos += completed_delta
    if failed_delta:
        job.failed_repos += failed_delta
    await session.commit()


async def _index_single_repo(
    semaphore: asyncio.Semaphore,
    group_job_id: int,
    repo_status_id: int,
    gitlab_url: str,
    project_path: str,
    group_id: int,
    private_token: str,
    force_reindex: bool,
) -> None:
    """Index one repository within a group job, updating GroupRepoStatus as it progresses."""
    async with semaphore:
        try:
            # Create or reuse the Repository record and its IndexJob in a fresh session.
            async with AsyncSessionLocal() as session:
                existing = (
                    await session.execute(
                        select(Repository).where(
                            Repository.gitlab_url == gitlab_url,
                            Repository.project_path == project_path,
                        )
                    )
                ).scalars().first()

                if existing is None:
                    repo = Repository(
                        gitlab_url=gitlab_url,
                        project_path=project_path,
                        project_id="",
                        name=project_path.split("/")[-1],
                        group_id=group_id,  # primary group hint (cosmetic)
                    )
                    session.add(repo)
                    await session.commit()
                    await session.refresh(repo)
                else:
                    repo = existing
                    await session.commit()

                # Add membership (INSERT OR IGNORE so existing links survive).
                await session.execute(
                    sqlite_insert(GroupMembership)
                    .values(group_id=group_id, repository_id=repo.id)
                    .on_conflict_do_nothing(index_elements=["group_id", "repository_id"])
                )
                await session.commit()

                index_job = IndexJob(
                    repository_id=repo.id,
                    status=JobStatus.PENDING.value,
                    progress=0,
                    current_step="En cola (grupo)...",
                )
                session.add(index_job)
                await session.commit()
                await session.refresh(index_job)

                repo_id = repo.id
                index_job_id = index_job.id

            # Mark as indexing in the status row.
            async with AsyncSessionLocal() as session:
                rs = await session.get(GroupRepoStatus, repo_status_id)
                if rs:
                    rs.repository_id = repo_id
                    rs.status = "indexing"
                    await session.commit()

            # Run the per-repo indexing pipeline (creates its own sessions internally).
            await run_index_job(
                index_job_id, gitlab_url, project_path, private_token, None, force_reindex
            )

            # Check final status of the IndexJob.
            async with AsyncSessionLocal() as session:
                final_job = await session.get(IndexJob, index_job_id)
                succeeded = final_job is not None and final_job.status == JobStatus.DONE.value
                fail_msg = (final_job.error_message if final_job else "") if not succeeded else ""

            async with AsyncSessionLocal() as session:
                rs = await session.get(GroupRepoStatus, repo_status_id)
                group_job = await session.get(GroupIndexJob, group_job_id)
                if rs:
                    rs.status = "done" if succeeded else "failed"
                    if not succeeded:
                        rs.error_message = fail_msg
                if group_job:
                    if succeeded:
                        group_job.completed_repos += 1
                    else:
                        group_job.failed_repos += 1
                    done = group_job.completed_repos + group_job.failed_repos
                    group_job.current_step = (
                        f"Completados {done}/{group_job.total_repos}..."
                    )
                await session.commit()

        except Exception as exc:
            logger.exception("Failed to index repo '%s' in group job %d", project_path, group_job_id)
            async with AsyncSessionLocal() as session:
                rs = await session.get(GroupRepoStatus, repo_status_id)
                group_job = await session.get(GroupIndexJob, group_job_id)
                if rs:
                    rs.status = "failed"
                    rs.error_message = str(exc)
                if group_job:
                    group_job.failed_repos += 1
                    done = group_job.completed_repos + group_job.failed_repos
                    group_job.current_step = f"Completados {done}/{group_job.total_repos}..."
                await session.commit()


async def run_group_index_job(
    group_job_id: int,
    gitlab_url: str,
    group_path: str,
    private_token: str,
    force_reindex: bool = False,
    include_subgroups: bool = True,
) -> None:
    """Entry point called by BackgroundTasks. Creates its own DB sessions."""
    async with AsyncSessionLocal() as session:
        job = await session.get(GroupIndexJob, group_job_id)
        if job is None:
            logger.error("GroupIndexJob %d not found", group_job_id)
            return
        group = await session.get(GitLabGroup, job.group_id)
        if group is None:
            logger.error("GitLabGroup %d not found", job.group_id)
            return
        group_id = group.id

        try:
            # --- 1. Discover projects in the group ---
            await _update_group_job(
                session, job,
                status=GroupIndexStatus.DISCOVERING.value,
                step="Descubriendo proyectos del grupo...",
            )

            async with GitLabClient(base_url=gitlab_url, private_token=private_token) as client:
                gl_group = await client.get_group(group_path)
                projects = await client.list_group_projects(
                    group_path, include_subgroups=include_subgroups
                )

            # Update group metadata from GitLab response.
            group.gitlab_group_id = str(gl_group.get("id", ""))
            group.name = gl_group.get("name") or group_path.split("/")[-1]
            group.description = gl_group.get("description") or ""
            group.updated_at = datetime.now(timezone.utc)
            await session.commit()

            if not projects:
                await _update_group_job(
                    session, job,
                    status=GroupIndexStatus.DONE.value,
                    step="Sin proyectos en el grupo.",
                )
                return

            # --- 2. Create per-repo status rows ---
            repo_status_ids: list[tuple[dict, int]] = []
            for proj in projects:
                rs = GroupRepoStatus(
                    group_job_id=job.id,
                    project_path=proj.get("path_with_namespace", ""),
                    status="pending",
                )
                session.add(rs)
            await session.commit()

            # Fetch the created rows back for their IDs.
            rs_rows = (
                await session.execute(
                    select(GroupRepoStatus).where(GroupRepoStatus.group_job_id == job.id)
                )
            ).scalars().all()

            job.total_repos = len(rs_rows)
            await session.commit()

            # Pair project dicts with their status row IDs in insertion order.
            paired = list(zip(projects, rs_rows))

        except (GitLabAuthError, GitLabNotFoundError, GitLabRateLimitError) as exc:
            await _update_group_job(
                session, job,
                status=GroupIndexStatus.FAILED.value,
                step=f"Error de GitLab: {exc}",
                error_summary=str(exc),
            )
            return
        except Exception as exc:
            logger.exception("Unexpected error in group job %d discovery phase", group_job_id)
            await _update_group_job(
                session, job,
                status=GroupIndexStatus.FAILED.value,
                step=f"Error inesperado: {exc}",
                error_summary=str(exc),
            )
            return

    # --- 3. Index all repos with concurrency limit ---
    async with AsyncSessionLocal() as session:
        job = await session.get(GroupIndexJob, group_job_id)
        await _update_group_job(
            session, job,
            status=GroupIndexStatus.INDEXING.value,
            step=f"Indexando {len(paired)} repositorios (concurrencia={settings.group_concurrency})...",
        )

    semaphore = asyncio.Semaphore(settings.group_concurrency)
    tasks = [
        _index_single_repo(
            semaphore,
            group_job_id,
            rs.id,
            gitlab_url,
            proj.get("path_with_namespace", ""),
            group_id,
            private_token,
            force_reindex,
        )
        for proj, rs in paired
    ]
    await asyncio.gather(*tasks)

    # --- 4. Generate group overview wiki ---
    async with AsyncSessionLocal() as session:
        job = await session.get(GroupIndexJob, group_job_id)
        await _update_group_job(
            session, job,
            status=GroupIndexStatus.GENERATING_OVERVIEW.value,
            step="Generando overview del grupo...",
        )

    # Collect wiki summaries for each successfully indexed repo.
    repo_summaries: list[dict] = []
    indexed_repo_ids: list[int] = []

    async with AsyncSessionLocal() as session:
        rs_rows = (
            await session.execute(
                select(GroupRepoStatus).where(GroupRepoStatus.group_job_id == group_job_id)
            )
        ).scalars().all()

        for rs in rs_rows:
            if rs.repository_id is None or rs.status != "done":
                continue
            indexed_repo_ids.append(rs.repository_id)
            repo = await session.get(Repository, rs.repository_id)
            pages = (
                await session.execute(
                    select(WikiPage)
                    .where(WikiPage.repository_id == rs.repository_id)
                    .order_by(WikiPage.order)
                    .limit(5)
                )
            ).scalars().all()
            if repo and pages:
                repo_summaries.append(
                    {
                        "name": repo.name,
                        "path": repo.project_path,
                        "pages": [
                            {"title": p.title, "content": p.content_markdown[:300]}
                            for p in pages
                        ],
                    }
                )

    try:
        generator = WikiGenerator()
        group_name = group_path.split("/")[-1]

        async with AsyncSessionLocal() as session:
            gl_grp = await session.get(GitLabGroup, group_id)
            if gl_grp and gl_grp.name:
                group_name = gl_grp.name

        overview_md = await generator.generate_group_overview(group_name, repo_summaries)
        await generator.close()
    except Exception as exc:
        logger.warning("Failed to generate group overview for job %d: %s", group_job_id, exc)
        overview_md = f"*Overview generation failed: {exc}*"

    # Build cross-repo dependency graph.
    try:
        cross_graph = await build_cross_repo_graph(indexed_repo_ids)
    except Exception as exc:
        logger.warning("Cross-repo graph build failed for group job %d: %s", group_job_id, exc)
        cross_graph = {"nodes": [], "edges": []}

    # --- 5. Save results and mark DONE ---
    async with AsyncSessionLocal() as session:
        group = await session.get(GitLabGroup, group_id)
        job = await session.get(GroupIndexJob, group_job_id)
        if group:
            group.overview_markdown = overview_md
            group.cross_repo_graph = cross_graph
            group.updated_at = datetime.now(timezone.utc)
        if job:
            job.status = GroupIndexStatus.DONE.value
            job.current_step = "Listo"
            job.finished_at = datetime.now(timezone.utc)
        await session.commit()
