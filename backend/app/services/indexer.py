"""
Orquestador del pipeline de indexado.

Este módulo es el que corre en background (FastAPI BackgroundTasks) y va:
1. Conectando a GitLab y trayendo metadata + árbol de archivos.
2. Analizando la estructura (sin IA).
3. Generando cada página del wiki con IA, leyendo contenido real de archivos relevantes.
4. Persistiendo todo en la base de datos y actualizando el progreso del IndexJob para que
   el frontend pueda hacer polling y mostrar una barra de progreso real.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
from datetime import datetime, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.models.db_models import IndexJob, JobStatus, Repository, WikiPage
from app.services.code_chunker import chunk_files
from app.services.dependency_graph import build_dependency_graph
from app.services.embedding_client import EmbeddingError, get_embedding_client
from app.services.gitlab_client import GitLabAuthError, GitLabClient, GitLabNotFoundError, GitLabRateLimitError
from app.services.structure_analyzer import EXTENSION_LANGUAGE, analyze_structure
from app.services.vector_store import VectorStore
from app.services.wiki_generator import FileSnippet, WikiGenerator

logger = logging.getLogger(__name__)


async def _update_job(session: AsyncSession, job: IndexJob, *, status: str | None = None,
                       progress: int | None = None, step: str | None = None,
                       error: str | None = None) -> None:
    if status is not None:
        job.status = status
        if status in (JobStatus.DONE.value, JobStatus.FAILED.value):
            job.finished_at = datetime.now(timezone.utc)
    if progress is not None:
        job.progress = progress
    if step is not None:
        job.current_step = step
    if error is not None:
        job.error_message = error
    await session.commit()


async def run_index_job(job_id: int, gitlab_url: str, project_path: str,
                         private_token: str, branch: str | None, force_reindex: bool = False) -> None:
    """
    Punto de entrada llamado por BackgroundTasks. Crea su propia sesión de DB
    porque corre fuera del ciclo de vida normal de un request.
    """
    async with AsyncSessionLocal() as session:
        job = await session.get(IndexJob, job_id)
        if job is None:
            logger.error("Job %s no encontrado", job_id)
            return
        repo = await session.get(Repository, job.repository_id)

        try:
            await _index_repository(session, job, repo, gitlab_url, project_path, private_token,
                                     branch, force_reindex)
        except (GitLabAuthError, GitLabNotFoundError, GitLabRateLimitError) as e:
            await _update_job(session, job, status=JobStatus.FAILED.value, error=str(e))
        except Exception as e:  # noqa: BLE001 - queremos capturar cualquier fallo y reportarlo al usuario
            logger.exception("Fallo indexando job %s", job_id)
            await _update_job(session, job, status=JobStatus.FAILED.value, error=f"Error inesperado: {e}")


async def _index_repository(session: AsyncSession, job: IndexJob, repo: Repository,
                             gitlab_url: str, project_path: str, private_token: str,
                             branch: str | None, force_reindex: bool = False) -> None:
    async with GitLabClient(base_url=gitlab_url, private_token=private_token) as client:
        # --- 1. Metadata del proyecto ---
        await _update_job(session, job, status=JobStatus.CLONING.value, progress=5, step="Conectando con GitLab...")
        project = await client.get_project(project_path)
        target_branch = branch or project.default_branch

        # --- Indexado incremental: si el commit no cambió desde la última vez y ya hay un wiki
        # generado, no hace falta volver a leer todo el árbol ni gastar llamadas al LLM/embeddings.
        previous_sha = repo.last_commit_sha
        existing_pages_count = (
            await session.execute(
                select(func.count(WikiPage.id)).where(WikiPage.repository_id == repo.id)
            )
        ).scalar()

        if (not force_reindex and previous_sha and previous_sha == project.last_commit_sha
                and existing_pages_count > 0):
            await _update_job(
                session, job, status=JobStatus.DONE.value, progress=100,
                step=f"Sin cambios desde el último indexado (commit {project.last_commit_sha[:8]}); wiki existente reutilizado.",
            )
            return

        repo.project_id = project.id
        repo.name = project.name
        repo.description = project.description
        repo.default_branch = target_branch
        repo.last_commit_sha = project.last_commit_sha
        await session.commit()

        # --- 2. Árbol de archivos ---
        await _update_job(session, job, progress=15, step="Listando árbol de archivos del repositorio...")
        tree_files = await client.list_repository_tree(project.id, target_branch, settings.max_files_to_index)
        all_paths = [f.path for f in tree_files]

        # --- 3. Análisis estático (sin IA) ---
        await _update_job(session, job, status=JobStatus.ANALYZING.value, progress=25, step="Analizando estructura del repositorio...")
        structure = analyze_structure(all_paths)

        # --- 4. Leer README y manifiestos de dependencias en paralelo ---
        await _update_job(session, job, progress=35, step="Leyendo README y manifiestos de dependencias...")
        readme_content = None
        if structure.readme_path:
            readme_content = await client.get_file_content(project.id, structure.readme_path, target_branch)

        manifest_paths = structure.dependency_manifests[:10]
        manifest_contents = await asyncio.gather(
            *[client.get_file_content(project.id, p, target_branch) for p in manifest_paths]
        )
        manifest_snippets = [
            FileSnippet(path=p, content=c)
            for p, c in zip(manifest_paths, manifest_contents)
            if c
        ]

        generator = WikiGenerator()
        new_pages: list[WikiPage] = []
        order_counter = 0

        # Load existing pages for incremental regeneration: if a page's source hash
        # hasn't changed since the last run, we reuse its content instead of calling the LLM.
        existing_pages: dict[str, WikiPage] = {
            p.slug: p
            for p in (
                await session.execute(select(WikiPage).where(WikiPage.repository_id == repo.id))
            ).scalars().all()
        }

        try:
            # --- 5. Página: Overview ---
            await _update_job(session, job, status=JobStatus.GENERATING.value, progress=45, step="Generando página: Overview...")
            lang_summary = ", ".join(f"{l}:{c}" for l, c in list(structure.languages.items())[:8])
            overview_hash = _compute_source_hash(
                readme_content or "",
                lang_summary,
                ",".join(structure.package_managers),
                ",".join(structure.dependency_manifests),
            )
            overview_md = (
                _reuse_if_unchanged("overview", overview_hash, existing_pages, force_reindex)
                or await generator.generate_overview(project.name, structure, readme_content)
            )
            new_pages.append(WikiPage(
                repository_id=repo.id, slug="overview", title="Overview", order=order_counter,
                content_markdown=overview_md, source_files=[structure.readme_path] if structure.readme_path else [],
                source_hash=overview_hash,
            ))
            order_counter += 1

            # --- 6. Página: Arquitectura ---
            await _update_job(session, job, progress=55, step="Generando página: Arquitectura...")
            modules_desc_key = "|".join(
                f"{m.path}:{m.file_count}:{','.join(m.languages)}" for m in structure.modules[:25]
            )
            arch_hash = _compute_source_hash(
                modules_desc_key,
                ",".join(structure.entrypoints),
                ",".join(structure.config_files),
            )
            arch_md = (
                _reuse_if_unchanged("architecture", arch_hash, existing_pages, force_reindex)
                or await generator.generate_architecture(project.name, structure)
            )
            new_pages.append(WikiPage(
                repository_id=repo.id, slug="architecture", title="Arquitectura", order=order_counter,
                content_markdown=arch_md, source_files=[m.path for m in structure.modules[:25]],
                source_hash=arch_hash,
            ))
            order_counter += 1

            # --- 7. Páginas por módulo principal (generadas en paralelo) ---
            top_modules = [m for m in structure.modules if m.path != "."][:settings.max_module_pages]
            await _update_job(session, job, progress=60,
                               step=f"Generando {len(top_modules)} páginas de módulo en paralelo...")

            _llm_sem = asyncio.Semaphore(settings.max_concurrent_module_generations)

            async def _process_module(module) -> WikiPage | None:
                sample_paths = module.sample_files[:settings.sample_files_per_module]
                sample_contents = await asyncio.gather(
                    *[client.get_file_content(project.id, fp, target_branch) for fp in sample_paths]
                )
                snippets = [
                    FileSnippet(path=fp, content=c)
                    for fp, c in zip(sample_paths, sample_contents)
                    if c
                ]
                if not snippets:
                    return None
                slug = "module-" + module.path.replace("/", "-").lower()
                mod_hash = _compute_source_hash(*(s.content for s in snippets))
                cached = _reuse_if_unchanged(slug, mod_hash, existing_pages, force_reindex)
                if cached is None:
                    async with _llm_sem:
                        cached = await generator.generate_module_page(project.name, module, snippets)
                return WikiPage(
                    repository_id=repo.id, slug=slug, title=f"Módulo: {module.path}",
                    order=0,  # filled in below after sorting
                    parent_slug="modules", content_markdown=cached,
                    source_files=[s.path for s in snippets],
                    source_hash=mod_hash,
                )

            module_pages = await asyncio.gather(*[_process_module(m) for m in top_modules])
            for page in module_pages:
                if page is not None:
                    page.order = order_counter
                    new_pages.append(page)
                    order_counter += 1

            # --- 8. Página: Cómo ejecutar el proyecto ---
            await _update_job(session, job, progress=80, step="Generando página: Cómo ejecutar el proyecto...")
            setup_hash = _compute_source_hash(
                *(s.content for s in manifest_snippets),
                readme_content or "",
                ",".join(structure.package_managers),
            )
            setup_md = (
                _reuse_if_unchanged("setup", setup_hash, existing_pages, force_reindex)
                or await generator.generate_setup_guide(project.name, structure, manifest_snippets, readme_content)
            )
            new_pages.append(WikiPage(
                repository_id=repo.id, slug="setup", title="Cómo ejecutar el proyecto", order=order_counter,
                content_markdown=setup_md, source_files=structure.dependency_manifests,
                source_hash=setup_hash,
            ))

        finally:
            await generator.close()

        # Atomic swap: delete old pages and insert all new ones in a single commit.
        # If anything above raised an exception, old pages are preserved (no delete ran).
        await session.execute(delete(WikiPage).where(WikiPage.repository_id == repo.id))
        session.add_all(new_pages)
        await session.commit()

        # --- 9. Lectura de archivos de código en paralelo (reutilizada por Qdrant y el grafo) ---
        await _update_job(session, job, progress=82, step="Leyendo archivos de código del repositorio...")
        code_file_contents = await _read_code_files(client, project.id, target_branch, structure)

        # --- 10. Grafo de dependencias entre módulos ---
        await _update_job(session, job, progress=85, step="Construyendo grafo de dependencias entre módulos...")
        try:
            languages_by_path = {
                path: EXTENSION_LANGUAGE.get(os.path.splitext(path)[1].lower())
                for path in code_file_contents
            }
            graph = build_dependency_graph(code_file_contents, languages_by_path)
            repo.dependency_graph = {
                "nodes": graph.nodes,
                "edges": [{"source": e.source, "target": e.target, "weight": e.weight} for e in graph.edges],
            }
        except Exception:
            logger.exception("Fallo construyendo el grafo de dependencias para repo %s (job %s)", repo.id, job.id)
            repo.dependency_graph = {"nodes": [], "edges": []}
        await session.commit()

        # --- 11. Incremental vector indexing ---
        # Failure here (Qdrant down, embedding service down) must NOT fail the job:
        # the generated wiki is still valid and useful without RAG.
        await _update_job(session, job, status=JobStatus.EMBEDDING.value, progress=90,
                           step="Indexando código en Qdrant para búsqueda semántica...")
        try:
            new_hashes = _compute_file_hashes(code_file_contents)
            old_hashes: dict[str, str] = repo.file_hashes or {}

            changed_files = {p: c for p, c in code_file_contents.items() if new_hashes[p] != old_hashes.get(p)}
            deleted_paths = set(old_hashes) - set(new_hashes)

            if not changed_files and not deleted_paths:
                logger.info("No code files changed since last embed for repo %s; skipping re-embedding.", repo.id)
                repo.indexed_in_qdrant = True
            else:
                # Reset when files were deleted (chunks can't be removed by path) or on first indexing.
                # Otherwise just upsert the changed files — unchanged file vectors remain valid.
                full_reset = bool(deleted_paths) or not repo.indexed_in_qdrant
                files_to_embed = code_file_contents if full_reset else changed_files
                logger.info(
                    "Embedding %d/%d files for repo %s (full_reset=%s, deleted=%d)",
                    len(files_to_embed), len(code_file_contents), repo.id, full_reset, len(deleted_paths),
                )
                await _embed_repository_code(files_to_embed, repo.id, full_reset=full_reset)
                repo.indexed_in_qdrant = True

            repo.file_hashes = new_hashes
        except Exception:
            logger.exception("Fallo indexando código en Qdrant para repo %s (job %s); el wiki sigue disponible.",
                              repo.id, job.id)
            repo.indexed_in_qdrant = False
        await session.commit()

        await _update_job(session, job, status=JobStatus.DONE.value, progress=100, step="Indexado completo.")


async def _read_code_files(client: GitLabClient, project_id: str, branch: str, structure) -> dict[str, str]:
    """
    Lee el contenido de los archivos de código del repo (filtrando por extensiones
    reconocidas) en paralelo, con un semáforo para no saturar el servidor GitLab.
    Centralizado aquí porque Qdrant y el grafo de dependencias necesitan los mismos archivos.
    """
    code_paths = [
        p for p in structure.all_paths
        if any(p.lower().endswith(ext) for ext in EXTENSION_LANGUAGE)
    ][:settings.max_files_to_embed]

    semaphore = asyncio.Semaphore(settings.fetch_concurrency)

    async def fetch_one(path: str) -> tuple[str, str] | None:
        async with semaphore:
            content = await client.get_file_content(project_id, path, branch)
            if content and len(content) <= settings.max_file_size_bytes:
                return path, content
            return None

    results = await asyncio.gather(*[fetch_one(p) for p in code_paths])
    return dict(r for r in results if r is not None)


def _compute_file_hashes(file_contents: dict[str, str]) -> dict[str, str]:
    return {
        path: hashlib.sha256(content.encode(errors="replace")).hexdigest()
        for path, content in file_contents.items()
    }


def _compute_source_hash(*texts: str | None) -> str:
    combined = "\n---\n".join(t for t in texts if t)
    return hashlib.sha256(combined.encode(errors="replace")).hexdigest()[:16]


def _reuse_if_unchanged(
    slug: str,
    source_hash: str,
    existing_pages: dict[str, "WikiPage"],
    force_reindex: bool,
) -> str | None:
    if force_reindex:
        return None
    existing = existing_pages.get(slug)
    if existing and existing.source_hash == source_hash:
        logger.info("Skipping LLM for page '%s' (source_hash=%s)", slug, source_hash)
        return existing.content_markdown
    return None


async def _embed_repository_code(
    file_contents: dict[str, str], repository_id: int, *, full_reset: bool = True
) -> None:
    """
    Chunks, embeds, and upserts code into the Qdrant collection for this repo.
    When full_reset=True the collection is dropped and recreated first (needed when
    files were deleted or on first indexing). When False, only the provided files are
    upserted — existing vectors for unchanged files remain valid.
    """
    chunks = chunk_files(file_contents)
    if not chunks:
        logger.warning("No se encontraron chunks de código para embeber en repo %s", repository_id)
        return

    embedding_client = get_embedding_client()
    vector_store = VectorStore(repository_id)
    try:
        if full_reset:
            await vector_store.reset_collection()
        for i in range(0, len(chunks), settings.embedding_batch_size):
            batch = chunks[i:i + settings.embedding_batch_size]
            texts = [c.content for c in batch]
            try:
                embeddings = await embedding_client.embed_batch(texts)
            except EmbeddingError as e:
                logger.error("Fallo embebiendo batch %d-%d del repo %s: %s", i, i + len(batch), repository_id, e)
                raise
            await vector_store.upsert_chunks(batch, embeddings)
    finally:
        await vector_store.close()
