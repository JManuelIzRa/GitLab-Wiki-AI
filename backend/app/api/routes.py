"""
Endpoints REST de la aplicación.

Convención de rutas:
- POST /api/repositories/index           -> arranca un job de indexado (no bloqueante)
- GET  /api/jobs/{job_id}                -> consulta progreso de un job (para polling)
- GET  /api/repositories                 -> lista repos ya indexados
- GET  /api/repositories/{id}/wiki       -> estructura del wiki (lista de páginas, sin contenido)
- GET  /api/repositories/{id}/wiki/{slug}-> contenido de una página específica
- GET  /api/repositories/{id}/export     -> descarga el wiki completo como un .md único
- GET  /api/repositories/{id}/dependency-graph -> grafo de dependencias entre módulos
- POST /api/repositories/{id}/search     -> búsqueda semántica directa sobre el código (sin LLM)
- POST /api/repositories/{id}/chat       -> pregunta libre sobre el repo indexado, respondida con el wiki como contexto
- DELETE /api/repositories/{id}          -> borra un repo indexado y sus páginas
"""
from __future__ import annotations

import logging

import openai
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.models.db_models import IndexJob, JobStatus, Repository, WikiPage
from app.models.schemas import (
    ChatRequest, ChatResponse, CodeSearchRequest, CodeSearchResponse, CodeSource,
    DependencyGraphResponse, IndexJobResponse, IndexRepositoryRequest, RepositorySummary,
    WikiPageDetail, WikiPageSummary, WikiPageUpdate, WikiStructureResponse,
)
from app.services.embedding_client import EmbeddingError, get_embedding_client
from app.services.indexer import run_index_job
from app.services.vector_store import VectorStore
from app.services.wiki_exporter import export_wiki_to_markdown
from app.services.wiki_generator import WikiGenerator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


def _get_wiki_generator(request: Request) -> WikiGenerator:
    return request.app.state.wiki_generator


@router.post("/repositories/index", response_model=IndexJobResponse)
async def index_repository(
    payload: IndexRepositoryRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
):
    """
    Crea (o reutiliza) el registro de Repository y lanza un IndexJob en background.
    Devuelve inmediatamente el job_id para que el frontend haga polling de progreso.
    """
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


@router.get("/repositories", response_model=list[RepositorySummary])
async def list_repositories(session: AsyncSession = Depends(get_session)):
    repos = (await session.execute(select(Repository).order_by(Repository.updated_at.desc()))).scalars().all()
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
    """Persists a manual edit to a wiki page's markdown content."""
    page = (
        await session.execute(
            select(WikiPage).where(WikiPage.repository_id == repo_id, WikiPage.slug == slug)
        )
    ).scalar_one_or_none()
    if page is None:
        raise HTTPException(status_code=404, detail="Página no encontrada")
    page.content_markdown = payload.content_markdown
    await session.commit()
    await session.refresh(page)
    return page


@router.get("/repositories/{repo_id}/dependency-graph", response_model=DependencyGraphResponse)
async def get_dependency_graph(repo_id: int, session: AsyncSession = Depends(get_session)):
    """
    Devuelve el grafo de dependencias entre módulos, calculado durante el indexado a
    partir de imports/requires reales detectados en el código (no solo agrupación
    por carpeta). Útil para visualizar qué módulo depende de cuál.
    """
    repo = await session.get(Repository, repo_id)
    if repo is None:
        raise HTTPException(status_code=404, detail="Repositorio no encontrado")

    graph = repo.dependency_graph or {"nodes": [], "edges": []}
    return DependencyGraphResponse(nodes=graph.get("nodes", []), edges=graph.get("edges", []))


@router.get("/repositories/{repo_id}/export")
async def export_wiki(repo_id: int, session: AsyncSession = Depends(get_session)):
    """
    Descarga el wiki completo como un único archivo .md autocontenido, con índice
    enlazado y metadata del repo al inicio. Útil para compartir fuera de la app
    (Confluence, Notion, un PR, etc.) o guardar una copia offline.
    """
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


@router.post("/repositories/{repo_id}/search", response_model=CodeSearchResponse)
async def search_code(repo_id: int, payload: CodeSearchRequest, session: AsyncSession = Depends(get_session)):
    """
    Búsqueda semántica directa sobre el código indexado en Qdrant, SIN pasar por el LLM.
    Útil como "grep semántico" instantáneo: encontrar dónde vive cierta lógica sin esperar
    una respuesta generada. Mucho más rápido y barato que /chat porque no hay generación.
    """
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


@router.post("/repositories/{repo_id}/chat", response_model=ChatResponse)
async def chat_with_repo(
    repo_id: int,
    payload: ChatRequest,
    session: AsyncSession = Depends(get_session),
    wiki_generator: WikiGenerator = Depends(_get_wiki_generator),
):
    """
    Responde una pregunta libre sobre el repositorio usando RAG:
    1. Embebe la pregunta del usuario.
    2. Busca en Qdrant los chunks de código semánticamente más relevantes de este repo.
    3. Le pasa esos chunks (+ un resumen breve del wiki, si existe) al LLM como contexto.

    Si el código no se pudo indexar en Qdrant (ej. Qdrant o el servicio de embeddings
    estaban caídos durante el indexado), se responde solo con el wiki como contexto,
    avisando de la degradación en vez de fallar.
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
            logger.warning("Embedding failed for chat query, falling back to wiki-only context: %s", e)

        if query_vector is not None:
            vector_store = VectorStore(repo_id)
            try:
                retrieved_chunks = await vector_store.search(query_vector)
            except Exception:
                logger.warning("Qdrant search failed for repo %s, falling back to wiki-only context", repo_id)
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
            file_path=c.file_path,
            start_line=c.start_line,
            end_line=c.end_line,
            content=c.content,
            score=c.score,
        )
        for c in retrieved_chunks
    ]
    return ChatResponse(answer=answer, sources=sources)


@router.delete("/repositories/{repo_id}")
async def delete_repository(repo_id: int, session: AsyncSession = Depends(get_session)):
    repo = await session.get(Repository, repo_id)
    if repo is None:
        raise HTTPException(status_code=404, detail="Repositorio no encontrado")
    await session.delete(repo)
    await session.commit()
    # Clean up Qdrant collection so vector data doesn't accumulate indefinitely
    if repo.indexed_in_qdrant:
        vector_store = VectorStore(repo_id)
        try:
            await vector_store.drop_collection()
        finally:
            await vector_store.close()
    return {"ok": True}
