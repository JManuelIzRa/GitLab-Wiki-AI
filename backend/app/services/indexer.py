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
import logging
import os

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.models.db_models import IndexJob, JobStatus, Repository, WikiPage
from app.services.code_chunker import chunk_files
from app.services.dependency_graph import build_dependency_graph
from app.services.embedding_client import EmbeddingError, get_embedding_client
from app.services.gitlab_client import GitLabAuthError, GitLabClient, GitLabNotFoundError
from app.services.structure_analyzer import EXTENSION_LANGUAGE, analyze_structure
from app.services.vector_store import VectorStore
from app.services.wiki_generator import FileSnippet, WikiGenerator

logger = logging.getLogger(__name__)

# Cuántos módulos principales reciben su propia página generada por IA.
# El resto de módulos pequeños se mencionan solo en la página de arquitectura.
MAX_MODULE_PAGES = 6
# Cuántos archivos de muestra se leen por módulo para alimentar a la IA en la generación del wiki.
SAMPLE_FILES_PER_MODULE = 6
# Cuántos chunks de código se embeben por llamada al servicio de embeddings (batching).
EMBEDDING_BATCH_SIZE = 32
# Tope de archivos de código a leer e indexar en Qdrant (independiente del tope de listado del árbol).
MAX_FILES_TO_EMBED = 300
# Peticiones HTTP concurrentes al fetchar archivos del repo. Evita saturar el servidor GitLab.
FETCH_CONCURRENCY = 15


async def _update_job(session: AsyncSession, job: IndexJob, *, status: str | None = None,
                       progress: int | None = None, step: str | None = None,
                       error: str | None = None) -> None:
    if status is not None:
        job.status = status
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
        except (GitLabAuthError, GitLabNotFoundError) as e:
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

        # Borrar páginas previas con una sola query DELETE en vez de N deletes individuales
        await session.execute(delete(WikiPage).where(WikiPage.repository_id == repo.id))
        await session.commit()

        order_counter = 0

        # --- 5. Página: Overview ---
        await _update_job(session, job, status=JobStatus.GENERATING.value, progress=45, step="Generando página: Overview...")
        overview_md = await generator.generate_overview(project.name, structure, readme_content)
        session.add(WikiPage(
            repository_id=repo.id, slug="overview", title="Overview", order=order_counter,
            content_markdown=overview_md, source_files=[structure.readme_path] if structure.readme_path else [],
        ))
        order_counter += 1
        await session.commit()

        # --- 6. Página: Arquitectura ---
        await _update_job(session, job, progress=55, step="Generando página: Arquitectura...")
        arch_md = await generator.generate_architecture(project.name, structure)
        session.add(WikiPage(
            repository_id=repo.id, slug="architecture", title="Arquitectura", order=order_counter,
            content_markdown=arch_md, source_files=[m.path for m in structure.modules[:25]],
        ))
        order_counter += 1
        await session.commit()

        # --- 7. Páginas por módulo principal ---
        top_modules = [m for m in structure.modules if m.path != "."][:MAX_MODULE_PAGES]
        progress_per_module = 15 // max(len(top_modules), 1)
        current_progress = 60

        for module in top_modules:
            await _update_job(session, job, progress=current_progress, step=f"Generando página del módulo: {module.path}...")

            # Fetch all sample files for this module in parallel
            sample_paths = module.sample_files[:SAMPLE_FILES_PER_MODULE]
            sample_contents = await asyncio.gather(
                *[client.get_file_content(project.id, fp, target_branch) for fp in sample_paths]
            )
            snippets = [
                FileSnippet(path=fp, content=c)
                for fp, c in zip(sample_paths, sample_contents)
                if c
            ]

            if not snippets:
                current_progress += progress_per_module
                continue

            module_md = await generator.generate_module_page(project.name, module, snippets)
            slug = "module-" + module.path.replace("/", "-").lower()
            session.add(WikiPage(
                repository_id=repo.id, slug=slug, title=f"Módulo: {module.path}", order=order_counter,
                parent_slug="modules", content_markdown=module_md,
                source_files=[s.path for s in snippets],
            ))
            order_counter += 1
            await session.commit()
            current_progress += progress_per_module

        # --- 8. Página: Cómo ejecutar el proyecto ---
        await _update_job(session, job, progress=80, step="Generando página: Cómo ejecutar el proyecto...")
        setup_md = await generator.generate_setup_guide(project.name, structure, manifest_snippets, readme_content)
        session.add(WikiPage(
            repository_id=repo.id, slug="setup", title="Cómo ejecutar el proyecto", order=order_counter,
            content_markdown=setup_md, source_files=structure.dependency_manifests,
        ))
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

        # --- 11. Indexado vectorial del código en Qdrant (para RAG en el chat) ---
        # Un fallo aquí (Qdrant caído, servicio de embeddings caído) NO debe tirar todo el job:
        # el wiki ya generado sigue siendo válido y útil aunque el chat con RAG no esté disponible.
        await _update_job(session, job, status=JobStatus.EMBEDDING.value, progress=90,
                           step="Indexando código en Qdrant para búsqueda semántica...")
        try:
            await _embed_repository_code(code_file_contents, repo.id)
            repo.indexed_in_qdrant = True
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
    ][:MAX_FILES_TO_EMBED]

    semaphore = asyncio.Semaphore(FETCH_CONCURRENCY)

    async def fetch_one(path: str) -> tuple[str, str] | None:
        async with semaphore:
            content = await client.get_file_content(project_id, path, branch)
            if content and len(content) <= settings.max_file_size_bytes:
                return path, content
            return None

    results = await asyncio.gather(*[fetch_one(p) for p in code_paths])
    return {path: content for result in results if result is not None for path, content in [result]}


async def _embed_repository_code(file_contents: dict[str, str], repository_id: int) -> None:
    """
    Parte en chunks el contenido de código ya leído, lo embebe y lo sube a la colección
    de Qdrant de este repositorio.
    """
    chunks = chunk_files(file_contents)
    if not chunks:
        logger.warning("No se encontraron chunks de código para embeber en repo %s", repository_id)
        return

    embedding_client = get_embedding_client()
    vector_store = VectorStore(repository_id)
    try:
        await vector_store.reset_collection()
        for i in range(0, len(chunks), EMBEDDING_BATCH_SIZE):
            batch = chunks[i:i + EMBEDDING_BATCH_SIZE]
            texts = [c.content for c in batch]
            try:
                embeddings = await embedding_client.embed_batch(texts)
            except EmbeddingError as e:
                logger.error("Fallo embebiendo batch %d-%d del repo %s: %s", i, i + len(batch), repository_id, e)
                raise
            await vector_store.upsert_chunks(batch, embeddings)
    finally:
        await vector_store.close()
