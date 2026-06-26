"""
Vector store sobre Qdrant para permitir RAG (preguntas sobre el código real, no solo
sobre el wiki ya generado).

Cada repositorio indexado tiene su propia colección en Qdrant, nombrada
`{qdrant_collection_prefix}{repository_id}`, para que repos distintos no mezclen
resultados de búsqueda y para poder borrar/reindexar uno sin tocar los demás.

Los IDs de punto se derivan determinísticamente del path+chunk_index del código
(vía UUID5), así que reindexar el mismo archivo sobreescribe el punto en vez de
duplicarlo.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams

from app.core.config import settings
from app.services.code_chunker import CodeChunk

logger = logging.getLogger(__name__)

# Namespace fijo para generar UUIDs deterministas a partir de chunk_id (mismo input -> mismo UUID).
_POINT_ID_NAMESPACE = uuid.UUID("a51e0e0a-3c2c-4f3b-9b8e-5a2f0a6e8d10")


@dataclass
class RetrievedChunk:
    file_path: str
    start_line: int
    end_line: int
    content: str
    score: float


class VectorStore:
    def __init__(self, repository_id: int):
        self.repository_id = repository_id
        self.collection_name = f"{settings.qdrant_collection_prefix}{repository_id}"
        self._client = AsyncQdrantClient(host=settings.qdrant_host, port=settings.qdrant_port)

    @staticmethod
    def _point_id(chunk_id: str) -> str:
        return str(uuid.uuid5(_POINT_ID_NAMESPACE, chunk_id))

    async def reset_collection(self) -> None:
        """Borra (si existe) y recrea la colección de este repo. Se llama antes de cada reindexado."""
        await self.drop_collection()
        await self._client.create_collection(
            collection_name=self.collection_name,
            vectors_config=VectorParams(size=settings.embedding_dimensions, distance=Distance.COSINE),
        )

    async def drop_collection(self) -> None:
        """Borra la colección si existe. Silencia el error si no existía."""
        try:
            await self._client.delete_collection(self.collection_name)
        except Exception:
            logger.warning("No se pudo borrar la colección Qdrant '%s'", self.collection_name, exc_info=True)

    async def upsert_chunks(self, chunks: list[CodeChunk], embeddings: list[list[float]]) -> None:
        """Sube (o sobreescribe) los puntos correspondientes a una lista de chunks ya embebidos."""
        if len(chunks) != len(embeddings):
            raise ValueError(f"chunks ({len(chunks)}) y embeddings ({len(embeddings)}) deben tener el mismo tamaño")
        if not chunks:
            return

        points = [
            PointStruct(
                id=self._point_id(chunk.chunk_id),
                vector=embedding,
                payload={
                    "file_path": chunk.file_path,
                    "chunk_index": chunk.chunk_index,
                    "start_line": chunk.start_line,
                    "end_line": chunk.end_line,
                    "content": chunk.content,
                },
            )
            for chunk, embedding in zip(chunks, embeddings)
        ]
        await self._client.upsert(collection_name=self.collection_name, points=points)

    async def search(self, query_vector: list[float], top_k: int | None = None) -> list[RetrievedChunk]:
        """Busca los chunks de código semánticamente más cercanos a un vector de pregunta."""
        top_k = top_k or settings.rag_top_k
        try:
            results = await self._client.query_points(
                collection_name=self.collection_name,
                query=query_vector,
                limit=top_k,
            )
        except Exception:
            logger.warning("Búsqueda en Qdrant fallida para colección '%s'; degradando a contexto sin código.",
                           self.collection_name, exc_info=True)
            return []

        return [
            RetrievedChunk(
                file_path=point.payload["file_path"],
                start_line=point.payload["start_line"],
                end_line=point.payload["end_line"],
                content=point.payload["content"],
                score=point.score,
            )
            for point in results.points
        ]

    async def close(self) -> None:
        await self._client.close()

    @staticmethod
    async def cleanup_orphan_collections(known_repo_ids: set[int]) -> None:
        """Delete Qdrant collections whose repo ID is no longer in the database."""
        prefix = settings.qdrant_collection_prefix
        client = AsyncQdrantClient(host=settings.qdrant_host, port=settings.qdrant_port)
        try:
            response = await client.get_collections()
            for col in response.collections:
                name = col.name
                if not name.startswith(prefix):
                    continue
                suffix = name[len(prefix):]
                try:
                    repo_id = int(suffix)
                except ValueError:
                    continue
                if repo_id not in known_repo_ids:
                    logger.info("Deleting orphan Qdrant collection '%s' (repo %d not in DB)", name, repo_id)
                    try:
                        await client.delete_collection(name)
                    except Exception:
                        logger.warning("Failed to delete orphan collection '%s'", name, exc_info=True)
        except Exception:
            logger.warning("Qdrant orphan cleanup failed; skipping.", exc_info=True)
        finally:
            await client.close()
