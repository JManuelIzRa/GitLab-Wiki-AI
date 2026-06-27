"""Code search and RAG chat endpoints (per-repository)."""
from __future__ import annotations

import json
import logging

import openai
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api._cache import db_cache_get, db_cache_set
from app.core.config import settings
from app.core.rate_limit import limiter
from app.db.session import get_session
from app.models.db_models import Repository, WikiPage
from app.models.schemas import (
    ChatHistoryMessage, ChatRequest, ChatResponse, CodeSearchRequest, CodeSearchResponse, CodeSource,
)
from app.services.embedding_client import EmbeddingError, get_embedding_client
from app.services.vector_store import VectorStore
from app.services.wiki_generator import WikiGenerator

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_wiki_generator(request: Request) -> WikiGenerator:
    return request.app.state.wiki_generator


def _build_wiki_summary(question: str, page_rows: list, budget: int = 4000) -> str:
    """Rank wiki pages by weighted keyword relevance to the question, then build a context string.

    Scoring: title match = 5pts, heading match = 3pts, first-500-char body = 2pts, rest = 1pt.
    Top-3 most relevant pages get up to 800 chars each; remaining pages get 150 chars.
    Total output is capped at *budget* characters to avoid LLM token overflow.
    """
    q_words = {w.lower() for w in question.split() if len(w) > 2}

    def relevance(title: str, content: str) -> int:
        if not q_words:
            return 0
        title_l = title.lower()
        headings_l = " ".join(
            line.lstrip("#").strip() for line in content.split("\n") if line.startswith("#")
        ).lower()
        preview_l = content[:500].lower()
        body_l = content[500:3000].lower()
        return sum(
            5 * (w in title_l) + 3 * (w in headings_l) + 2 * (w in preview_l) + (w in body_l)
            for w in q_words
        )

    ranked = sorted(page_rows, key=lambda r: relevance(r[0], r[1]), reverse=True)

    parts: list[str] = []
    remaining = budget
    for i, (title, content) in enumerate(ranked):
        if remaining <= 0:
            break
        allotted = min(800 if i < 3 else 150, remaining)
        excerpt = content[:allotted]
        chunk = f"## {title}\n{excerpt}"
        parts.append(chunk)
        remaining -= len(chunk)

    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# Semantic code search
# ---------------------------------------------------------------------------

@router.post("/repositories/{repo_id}/search", response_model=CodeSearchResponse)
async def search_code(
    repo_id: int,
    payload: CodeSearchRequest,
    session: AsyncSession = Depends(get_session),
):
    """Semantic search over indexed code chunks in Qdrant — no LLM call."""
    repo = await session.get(Repository, repo_id)
    if repo is None:
        raise HTTPException(status_code=404, detail="Repositorio no encontrado")
    if not repo.indexed_in_qdrant:
        raise HTTPException(
            status_code=400,
            detail="Este repositorio no tiene el código indexado en Qdrant.",
        )

    try:
        query_vector = await get_embedding_client().embed_one(payload.query)
    except EmbeddingError as e:
        raise HTTPException(status_code=502, detail=f"No se pudo generar el embedding: {e}")

    vector_store = VectorStore(repo_id)
    try:
        chunks = await vector_store.search(query_vector, top_k=payload.top_k)
    finally:
        await vector_store.close()

    return CodeSearchResponse(results=[
        CodeSource(
            file_path=c.file_path, start_line=c.start_line, end_line=c.end_line,
            content=c.content, score=c.score,
        )
        for c in chunks
    ])


# ---------------------------------------------------------------------------
# RAG chat — non-streaming
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
    repo = await session.get(Repository, repo_id)
    if repo is None:
        raise HTTPException(status_code=404, detail="Repositorio no encontrado")

    cached = await db_cache_get(session, repo_id, payload.question)
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

    wiki_summary = _build_wiki_summary(payload.question, page_rows)

    retrieved_chunks = []
    if repo.indexed_in_qdrant:
        try:
            query_vector = await get_embedding_client().embed_one(payload.question)
            vector_store = VectorStore(repo_id)
            try:
                retrieved_chunks = await vector_store.search(query_vector)
            except Exception:
                logger.warning("Qdrant search failed for repo %s, using wiki-only context", repo_id, exc_info=True)
            finally:
                await vector_store.close()
        except EmbeddingError as e:
            logger.warning("Embedding failed for chat query, using wiki-only context: %s", e)

    history = [m.model_dump() for m in payload.history] if payload.history else None
    try:
        answer = await wiki_generator.answer_question_rag(
            project_name=repo.name,
            question=payload.question,
            retrieved_chunks=retrieved_chunks,
            wiki_summary=wiki_summary,
            history=history,
        )
    except openai.AuthenticationError:
        raise HTTPException(status_code=502, detail="No se pudo autenticar contra el LLM configurado.")
    except openai.APIConnectionError as e:
        raise HTTPException(status_code=502, detail=f"No se pudo conectar con el LLM en OPENAI_URL: {e}")
    except openai.APIError as e:
        raise HTTPException(status_code=502, detail=f"Error al consultar el LLM: {e}")

    sources = [
        CodeSource(
            file_path=c.file_path, start_line=c.start_line, end_line=c.end_line,
            content=c.content, score=c.score,
        )
        for c in retrieved_chunks
    ]
    await db_cache_set(session, repo_id, payload.question, answer, [s.model_dump() for s in sources])
    return ChatResponse(answer=answer, sources=sources)


# ---------------------------------------------------------------------------
# RAG chat — streaming SSE
# ---------------------------------------------------------------------------

@router.post("/repositories/{repo_id}/chat/stream")
@limiter.limit(settings.rate_limit_chat)
async def stream_chat_with_repo(
    request: Request,
    repo_id: int,
    payload: ChatRequest,
    session: AsyncSession = Depends(get_session),
    wiki_generator: WikiGenerator = Depends(_get_wiki_generator),
):
    """SSE: emits source chunks, then answer tokens, then a done event."""
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

    wiki_summary = _build_wiki_summary(payload.question, page_rows)

    retrieved_chunks = []
    if repo.indexed_in_qdrant:
        try:
            query_vector = await get_embedding_client().embed_one(payload.question)
            vector_store = VectorStore(repo_id)
            try:
                retrieved_chunks = await vector_store.search(query_vector)
            except Exception:
                logger.warning("Qdrant search failed for streaming chat (repo %s)", repo_id, exc_info=True)
            finally:
                await vector_store.close()
        except EmbeddingError as e:
            logger.warning("Embedding failed for streaming chat, using wiki-only: %s", e)

    sources = [
        CodeSource(
            file_path=c.file_path, start_line=c.start_line, end_line=c.end_line,
            content=c.content, score=c.score,
        )
        for c in retrieved_chunks
    ]

    repo_name = repo.name
    question = payload.question
    history = [m.model_dump() for m in payload.history] if payload.history else None

    async def event_generator():
        if sources:
            yield f"event: sources\ndata: {json.dumps([s.model_dump() for s in sources])}\n\n"
        try:
            async for token in wiki_generator.stream_answer_question_rag(
                project_name=repo_name,
                question=question,
                retrieved_chunks=retrieved_chunks,
                wiki_summary=wiki_summary,
                history=history,
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
