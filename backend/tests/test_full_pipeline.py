"""
Prueba end-to-end del pipeline completo de indexado (GitLab mock -> análisis -> DB -> Qdrant),
mockeando la capa de LLM (WikiGenerator._ask) y, en el primer escenario, también el embedding
para no depender de un LLM ni de un servicio de embeddings reales. Esto valida:
- El flujo completo de run_index_job, incluyendo el indexado vectorial y el grafo de dependencias
- La actualización de progreso del IndexJob en cada etapa (incluida la etapa EMBEDDING)
- La persistencia correcta de Repository y WikiPage en SQLite
- Que repo.indexed_in_qdrant se marca True cuando el embebido tiene éxito
- Que repo.dependency_graph se calcula con datos reales (regex sobre código real leído de GitLab)
- Que un fallo en el embebido (ej. Qdrant/embeddings inalcanzables) NO tira el job entero:
  el wiki generado sigue siendo válido y el job termina en DONE con indexed_in_qdrant=False,
  Y el grafo de dependencias se calcula igual (es independiente de si Qdrant está disponible)
- El manejo de errores de GitLab (token inválido)
"""

import asyncio
import sys

sys.path.insert(0, ".")

from unittest.mock import AsyncMock, patch

from sqlalchemy import select

from app.db.session import AsyncSessionLocal, engine, init_db
from app.models.db_models import Base, IndexJob, JobStatus, Repository, WikiPage


async def fake_ask(self, prompt: str, system_prompt=None, max_tokens=None) -> str:
    """Sustituye la llamada real al LLM por una respuesta determinística e instantánea."""
    if "Overview" in prompt:
        return "## Resumen\nEste es un proyecto demo en Node.js/Express para gestión de usuarios."
    if "Arquitectura" in prompt:
        return "## Arquitectura\nSigue un patrón router-controller simple.\n```mermaid\nflowchart TD\nA[index.js] --> B[api/users.js] --> C[utils/userStore.js]\n```"
    if "módulo" in prompt:
        return "## Módulo src\nContiene el entrypoint y los submódulos de la API."
    if "ejecutar" in prompt or "instalación" in prompt:
        return "## Instalación\n```bash\nnpm install\nnpm start\n```"
    return "Respuesta genérica de prueba."


async def fake_embed_batch(self, texts: list[str]) -> list[list[float]]:
    """Embeddings falsos de dimensión pequeña, deterministas, sin red real."""
    return [[float(len(t) % 7), 0.0, 1.0] for t in texts]


def make_run_index_job_importable():
    from app.services.indexer import run_index_job

    return run_index_job


async def scenario_success_with_embedding():
    """Indexado completo con el paso de embedding mockeado para que tenga éxito."""
    run_index_job = make_run_index_job_importable()

    async with AsyncSessionLocal() as session:
        repo = Repository(
            gitlab_url="http://127.0.0.1:9000",
            project_path="demo-group/demo-project",
            project_id="",
            name="demo-group/demo-project",
        )
        session.add(repo)
        await session.commit()
        await session.refresh(repo)

        job = IndexJob(repository_id=repo.id, status=JobStatus.PENDING.value, progress=0, current_step="En cola...")
        session.add(job)
        await session.commit()
        await session.refresh(job)
        job_id, repo_id = job.id, repo.id

    # VectorStore real apunta a 192.168.0.100:6333 (inalcanzable desde aquí), así que también
    # mockeamos reset_collection/upsert_chunks/close para que la parte de Qdrant en sí no
    # dependa de red, mientras probamos que el flujo de chunking + embedding se ejecuta bien.
    with (
        patch("app.services.wiki_generator.WikiGenerator._ask", new=fake_ask),
        patch("app.services.embedding_client.EmbeddingClient.embed_batch", new=fake_embed_batch),
        patch("app.services.vector_store.VectorStore.reset_collection", new=AsyncMock(return_value=None)),
        patch("app.services.vector_store.VectorStore.upsert_chunks", new=AsyncMock(return_value=None)),
        patch("app.services.vector_store.VectorStore.close", new=AsyncMock(return_value=None)),
    ):
        await run_index_job(
            job_id=job_id,
            gitlab_url="http://127.0.0.1:9000",
            project_path="demo-group/demo-project",
            private_token="test-token-123",
            branch=None,
        )

    async with AsyncSessionLocal() as session:
        job = await session.get(IndexJob, job_id)
        assert job.status == JobStatus.DONE.value
        assert job.progress == 100

        repo = await session.get(Repository, repo_id)
        assert repo.project_id == "42"
        assert repo.last_commit_sha == "abc1234567890"
        assert repo.indexed_in_qdrant is True, "con el embedding mockeado exitosamente, debe marcarse True"

        pages = (
            (await session.execute(select(WikiPage).where(WikiPage.repository_id == repo_id).order_by(WikiPage.order)))
            .scalars()
            .all()
        )

        slugs = {p.slug for p in pages}
        assert "overview" in slugs
        assert "architecture" in slugs
        assert "setup" in slugs
        assert any(s.startswith("module-") for s in slugs)

        assert repo.dependency_graph, "el grafo de dependencias debe haberse calculado durante el indexado"
        assert "nodes" in repo.dependency_graph and "edges" in repo.dependency_graph
        # El mock GitLab tiene index.js -> api/users.js -> utils/userStore.js, así que
        # el grafo real (calculado con regex sobre el código real leído de GitLab) debe
        # detectar al menos una dependencia entre los módulos resultantes.
        assert len(repo.dependency_graph["nodes"]) > 0, "debe haber detectado al menos un módulo"
        assert len(repo.dependency_graph["edges"]) > 0, (
            "debe haber detectado al menos una dependencia real (index.js importa api/users.js)"
        )


async def scenario_embedding_fails_gracefully():
    """
    Si el servicio de embeddings/Qdrant falla (ej. host real inalcanzable), el job NO debe
    fallar: el wiki ya generado debe persistir y el job debe terminar en DONE, solo con
    indexed_in_qdrant=False. Aquí dejamos que el EmbeddingClient real intente conectar a
    settings.embedding_url (que en este entorno de pruebas no es alcanzable) para simular
    justamente ese escenario sin mockear nada de la capa de embeddings/Qdrant.
    """
    run_index_job = make_run_index_job_importable()

    async with AsyncSessionLocal() as session:
        repo = Repository(
            gitlab_url="http://127.0.0.1:9000",
            project_path="demo-group/demo-project",
            project_id="",
            name="x",
        )
        session.add(repo)
        await session.commit()
        await session.refresh(repo)
        job = IndexJob(repository_id=repo.id, status=JobStatus.PENDING.value)
        session.add(job)
        await session.commit()
        await session.refresh(job)
        job_id, repo_id = job.id, repo.id

    with patch("app.services.wiki_generator.WikiGenerator._ask", new=fake_ask):
        # No mockeamos EmbeddingClient ni VectorStore: settings.embedding_url y
        # settings.qdrant_host apuntan a 192.168.0.100, inalcanzable en este sandbox,
        # así que esto ejercita el path real de fallo de red.
        await run_index_job(
            job_id=job_id,
            gitlab_url="http://127.0.0.1:9000",
            project_path="demo-group/demo-project",
            private_token="test-token-123",
            branch=None,
        )

    async with AsyncSessionLocal() as session:
        job = await session.get(IndexJob, job_id)
        repo = await session.get(Repository, repo_id)
        assert job.status == JobStatus.DONE.value, "el wiki debe completarse aunque el embedding falle"
        assert repo.indexed_in_qdrant is False

        pages = (await session.execute(select(WikiPage).where(WikiPage.repository_id == repo_id))).scalars().all()
        assert len(pages) == 4, "las páginas del wiki deben persistir aunque el embedding falle"

        assert repo.dependency_graph, (
            "el grafo de dependencias debe calcularse igual aunque Qdrant/embeddings fallen (es un paso independiente)"
        )
        assert len(repo.dependency_graph.get("edges", [])) > 0


async def scenario_invalid_gitlab_token():
    """Token de GitLab inválido debe marcar el job como FAILED con un mensaje claro."""
    run_index_job = make_run_index_job_importable()

    async with AsyncSessionLocal() as session:
        repo2 = Repository(
            gitlab_url="http://127.0.0.1:9000", project_path="demo-group/demo-project", project_id="", name="x"
        )
        session.add(repo2)
        await session.commit()
        await session.refresh(repo2)
        job2 = IndexJob(repository_id=repo2.id, status=JobStatus.PENDING.value)
        session.add(job2)
        await session.commit()
        await session.refresh(job2)
        job2_id = job2.id

    await run_index_job(job2_id, "http://127.0.0.1:9000", "demo-group/demo-project", "token-malo", None)

    async with AsyncSessionLocal() as session:
        job2 = await session.get(IndexJob, job2_id)
        assert job2.status == JobStatus.FAILED.value
        assert "Token inválido" in job2.error_message or "401" in job2.error_message


async def main():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await init_db()

    await scenario_success_with_embedding()
    await scenario_embedding_fails_gracefully()
    await scenario_invalid_gitlab_token()


if __name__ == "__main__":
    asyncio.run(main())
