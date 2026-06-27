"""
Punto de entrada de la aplicación FastAPI.

Para correr en desarrollo:
    uvicorn app.main:app --reload --port 8000

Variables de entorno clave (ver .env.example):
    OPENAI_URL          URL del servidor LLM compatible con OpenAI (local o remoto)
    EMBEDDING_URL       URL del servicio de embeddings
    QDRANT_HOST         Host del servidor Qdrant
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pythonjsonlogger import jsonlogger
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import select

from app.api.routes import router
from app.core.config import settings
from app.core.rate_limit import limiter
from app.db.session import AsyncSessionLocal, init_db
from app.models.db_models import IndexJob, JobStatus, Repository
from app.services.embedding_client import get_embedding_client
from app.services.vector_store import VectorStore
from app.services.wiki_generator import WikiGenerator


def _setup_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(
        jsonlogger.JsonFormatter(fmt="%(asctime)s %(levelname)s %(name)s %(message)s")
    )
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)


_setup_logging()
logger = logging.getLogger(__name__)

_EXTERNAL_SERVICES = [
    ("LLM (OPENAI_URL)", settings.openai_url),
    ("Embeddings (EMBEDDING_URL)", settings.embedding_url),
    ("Qdrant", f"http://{settings.qdrant_host}:{settings.qdrant_port}/"),
]


async def _warn_unreachable_services() -> None:
    """Log a warning for each external service that is not reachable at startup."""
    async with httpx.AsyncClient(timeout=3.0) as client:
        for name, url in _EXTERNAL_SERVICES:
            try:
                await client.get(url)
            except Exception as exc:
                logger.warning(
                    "Service '%s' at %s is not reachable: %s — "
                    "dependent features will be degraded until it comes up.",
                    name, url, exc,
                )


async def _staleness_reindex_loop() -> None:
    """Hourly background task: re-index repos whose content is stale (no webhook configured).

    Only runs when REINDEX_STALENESS_HOURS > 0 and a token is available per-repo or globally.
    """
    while True:
        await asyncio.sleep(3600)
        if not settings.reindex_staleness_hours:
            continue
        threshold = datetime.now(timezone.utc) - timedelta(hours=settings.reindex_staleness_hours)
        try:
            async with AsyncSessionLocal() as session:
                stale = (await session.execute(
                    select(Repository).where(Repository.updated_at < threshold)
                )).scalars().all()
                for repo in stale:
                    token = repo.gitlab_token or settings.gitlab_default_token
                    if not token:
                        continue
                    active = (await session.execute(
                        select(IndexJob).where(
                            IndexJob.repository_id == repo.id,
                            IndexJob.status.notin_([JobStatus.DONE.value, JobStatus.FAILED.value]),
                        ).limit(1)
                    )).scalar()
                    if active:
                        continue
                    job = IndexJob(
                        repository_id=repo.id, status=JobStatus.PENDING.value, progress=0,
                        current_step="Re-indexado automático por contenido desactualizado...",
                    )
                    session.add(job)
                    await session.commit()
                    await session.refresh(job)
                    from app.services.indexer import run_index_job
                    asyncio.create_task(
                        run_index_job(job.id, repo.gitlab_url, repo.project_path, token, None, False)
                    )
                    logger.info("Staleness re-index queued for repo %s (%s)", repo.id, repo.project_path)
        except Exception:
            logger.exception("Staleness re-index loop encountered an error; will retry in 1h.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await _warn_unreachable_services()

    if settings.gitlab_webhook_secret_required and not settings.gitlab_webhook_secret:
        raise RuntimeError(
            "GITLAB_WEBHOOK_SECRET_REQUIRED=true but GITLAB_WEBHOOK_SECRET is not set. "
            "Set the secret or disable the requirement."
        )

    if not settings.gitlab_webhook_secret:
        logger.warning(
            "GITLAB_WEBHOOK_SECRET is not set — the webhook endpoint /api/webhooks/gitlab "
            "accepts unauthenticated requests. Set this variable in production to prevent "
            "unauthorized re-indexing triggered by anyone who knows the URL."
        )

    # Clean up Qdrant collections for repos that were deleted from the database.
    async with AsyncSessionLocal() as session:
        known_ids = set((await session.execute(select(Repository.id))).scalars().all())
    await VectorStore.cleanup_orphan_collections(known_ids)
    get_embedding_client()
    app.state.wiki_generator = WikiGenerator()

    staleness_task = asyncio.create_task(_staleness_reindex_loop())
    yield
    staleness_task.cancel()
    await app.state.wiki_generator.close()


app = FastAPI(
    title="DeepWiki for GitLab",
    description="Generador automático de documentación tipo wiki para repositorios GitLab (self-hosted o gitlab.com).",
    version="1.0.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    # credentials=True + origins=["*"] is rejected by browsers; auth is header-based, not cookie-based.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/health")
async def health_check():
    """Returns application status and reachability of each external service."""
    services: dict[str, str] = {}
    async with httpx.AsyncClient(timeout=3.0) as client:
        for name, url in _EXTERNAL_SERVICES:
            try:
                await client.get(url)
                services[name] = "ok"
            except Exception:
                services[name] = "unreachable"
    overall = "ok" if all(v == "ok" for v in services.values()) else "degraded"
    return {"status": overall, "services": services}
