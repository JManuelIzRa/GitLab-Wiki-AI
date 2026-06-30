"""
Configuración central de la aplicación.
Todos los valores se pueden sobreescribir con variables de entorno o un archivo .env
"""

import re

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- LLM de chat/generación (servidor OpenAI-compatible local) ---
    openai_url: str = "http://localhost:8000/"
    openai_chat_model: str = "qwen2.5-3b-instruct-q4_k_m.gguf"
    openai_api_key: str = "not-needed"  # algunos servidores locales exigen un valor no vacío aunque no lo validen

    # --- Embeddings (servicio propio, contrato OpenAI: {input, model} -> {data:[{embedding}]}) ---
    embedding_url: str = "http://localhost:8080/embed"
    openai_embedding_model: str = "text-embedding-3-small"
    embedding_api_key: str = ""
    embedding_timeout_seconds: float = 60.0
    embedding_dimensions: int = 384  # dimensión de text-embedding-3-small; ajustar si tu servicio usa otro modelo
    embedding_max_input_chars: int = 8000
    embedding_provider: str = "http"  # "http" (OpenAI-compatible) or "local" (HuggingFace)
    embedding_cache_folder: str = ""  # used when provider="local"; empty = HF default cache dir

    # --- Qdrant (vector store para RAG sobre código) ---
    qdrant_host: str = "localhost"
    qdrant_port: int = 6333
    qdrant_collection_prefix: str = "deepwiki_repo_"  # se sufija con el id del repo

    # --- Base de datos ---
    database_url: str = "sqlite+aiosqlite:///./deepwiki.db"

    # --- Indexado ---
    max_files_to_index: int = 400  # tope de archivos a leer por repo (evita timeouts)
    max_file_size_bytes: int = 200_000  # no leer archivos gigantes (binarios, lockfiles enormes, etc.)
    # Presupuesto de contexto por llamada a IA. Recortado respecto a un modelo grande en la nube:
    # un modelo local 3B cuantizado degrada mucho con prompts largos, así que preferimos contextos
    # más pequeños y más enfocados (vía RAG) en vez de "meter todo" en el prompt.
    max_chars_per_ai_call: int = 24_000
    max_chat_tokens: int = 2048

    # --- Chunking de código para RAG ---
    rag_top_k: int = 6  # nº de chunks de código recuperados por pregunta
    code_chunk_lines: int = 40
    code_chunk_lines_overlap: int = 15
    code_chunk_max_chars: int = 1500

    # --- Indexado / pipeline (sobreescribibles via .env) ---
    max_module_pages: int = 6  # módulos principales que reciben página propia de IA
    sample_files_per_module: int = 6  # archivos de muestra leídos por módulo para el prompt
    embedding_batch_size: int = 32  # chunks por llamada al servicio de embeddings
    max_files_to_embed: int = 300  # tope de archivos de código indexados en Qdrant
    fetch_concurrency: int = 15  # peticiones HTTP paralelas al fetchar archivos del repo
    # Concurrent LLM calls during module page generation. Keep low (2-3) for local models
    # that don't pipeline well; raise to 6-10 when using a cloud API.
    max_concurrent_module_generations: int = 3

    # --- CORS ---
    cors_origins: list[str] = ["*"]

    # --- Internacionalización ---
    # ISO language code for generated wiki content ("es", "en", "fr", "de", "pt", ...).
    # Affects both system and user prompts sent to the LLM.
    wiki_language: str = "es"

    # --- Webhooks de GitLab ---
    # Token que GitLab envía en la cabecera X-Gitlab-Token para autenticar el webhook.
    # Deja vacío para deshabilitar la validación (solo recomendable en desarrollo local).
    gitlab_webhook_secret: str = ""
    # Set to true to refuse startup when GITLAB_WEBHOOK_SECRET is not configured.
    # Recommended for production deployments where the webhook endpoint is public-facing.
    gitlab_webhook_secret_required: bool = False
    # PAT usado para re-indexar repos disparados por webhook. Debe tener scope read_api + read_repository.
    # Si está vacío, los webhooks de push solo marcan el repo como desactualizado pero no re-indexan.
    gitlab_default_token: str = ""

    # --- Staleness-based auto re-indexing ---
    # Hours after the last successful index after which a repo is considered stale and
    # automatically re-indexed (requires per-repo or global gitlab token). 0 = disabled.
    reindex_staleness_hours: int = 0

    # --- Rate limiting ---
    rate_limit_index: str = "5/minute"  # máx. jobs de indexado nuevos por IP
    rate_limit_chat: str = "30/minute"  # máx. preguntas de chat por IP

    # --- Chat cache ---
    chat_cache_max: int = 256  # max cached RAG answers stored per repo

    # --- Group indexing ---
    group_concurrency: int = 3  # repos indexed in parallel per group job

    @field_validator("openai_url", "embedding_url")
    @classmethod
    def _validate_http_url(cls, v: str) -> str:
        if not re.match(r"^https?://", v, re.IGNORECASE):
            raise ValueError(f"must start with http:// or https:// (got: {v!r})")
        return v

    @field_validator("qdrant_host")
    @classmethod
    def _validate_qdrant_host(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("QDRANT_HOST must not be empty")
        return v


settings = Settings()
