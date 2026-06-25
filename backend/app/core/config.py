"""
Configuración central de la aplicación.
Todos los valores se pueden sobreescribir con variables de entorno o un archivo .env
"""
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- LLM de chat/generación (servidor OpenAI-compatible local) ---
    openai_url: str = "http://192.168.0.100:8000/"
    openai_chat_model: str = "qwen2.5-3b-instruct-q4_k_m.gguf"
    openai_api_key: str = "not-needed"  # algunos servidores locales exigen un valor no vacío aunque no lo validen

    # --- Embeddings (servicio propio, contrato OpenAI: {input, model} -> {data:[{embedding}]}) ---
    embedding_url: str = "http://192.168.0.100:8080/embed"
    openai_embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 384  # dimensión de text-embedding-3-small; ajustar si tu servicio usa otro modelo

    # --- Qdrant (vector store para RAG sobre código) ---
    qdrant_host: str = "192.168.0.100"
    qdrant_port: int = 6333
    qdrant_collection_prefix: str = "deepwiki_repo_"  # se sufija con el id del repo

    # --- Base de datos ---
    database_url: str = "sqlite+aiosqlite:///./deepwiki.db"

    # --- Indexado ---
    max_files_to_index: int = 400          # tope de archivos a leer por repo (evita timeouts)
    max_file_size_bytes: int = 200_000      # no leer archivos gigantes (binarios, lockfiles enormes, etc.)
    # Presupuesto de contexto por llamada a IA. Recortado respecto a un modelo grande en la nube:
    # un modelo local 3B cuantizado degrada mucho con prompts largos, así que preferimos contextos
    # más pequeños y más enfocados (vía RAG) en vez de "meter todo" en el prompt.
    max_chars_per_ai_call: int = 12_000
    max_chat_tokens: int = 1200

    # --- Chunking de código para RAG ---
    chunk_max_chars: int = 1500       # alias de code_chunk_max_chars; usado en tests
    chunk_overlap_chars: int = 200    # superposición en chars (referencia para tests)
    rag_top_k: int = 6                # nº de chunks de código recuperados por pregunta
    code_chunk_lines: int = 40
    code_chunk_lines_overlap: int = 15
    code_chunk_max_chars: int = 1500

    # --- Cache local de modelos HuggingFace ---
    models_cache_dir: str = str(Path.home() / ".cache" / "deepwiki" / "models")

    # --- CORS ---
    cors_origins: list[str] = ["*"]

    # --- Workspace temporal para clones ---
    workspace_dir: str = "/tmp/deepwiki-gitlab-workspace"


settings = Settings()
