"""
Punto de entrada de la aplicación FastAPI.

Para correr en desarrollo:
    uvicorn app.main:app --reload --port 8000

Variables de entorno clave (ver .env.example):
    OPENAI_URL          URL del servidor LLM compatible con OpenAI (local o remoto)
    EMBEDDING_URL       URL del servicio de embeddings
    QDRANT_HOST         Host del servidor Qdrant
"""
import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.core.config import settings
from app.db.session import init_db
from app.services.embedding_client import get_embedding_client
from app.services.wiki_generator import WikiGenerator

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


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await _warn_unreachable_services()
    get_embedding_client()
    app.state.wiki_generator = WikiGenerator()
    yield
    await app.state.wiki_generator.close()


app = FastAPI(
    title="DeepWiki for GitLab",
    description="Generador automático de documentación tipo wiki para repositorios GitLab (self-hosted o gitlab.com).",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
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
