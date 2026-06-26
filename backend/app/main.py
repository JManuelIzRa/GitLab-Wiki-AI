"""
Punto de entrada de la aplicación FastAPI.

Para correr en desarrollo:
    uvicorn app.main:app --reload --port 8000

Variables de entorno clave (ver .env.example):
    OPENAI_URL          URL del servidor LLM compatible con OpenAI (local o remoto)
    EMBEDDING_URL       URL del servicio de embeddings
    QDRANT_HOST         Host del servidor Qdrant
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.core.config import settings
from app.db.session import init_db
from app.services.embedding_client import get_embedding_client
from app.services.wiki_generator import WikiGenerator


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
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
    return {"status": "ok"}
