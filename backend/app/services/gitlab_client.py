"""
Cliente para hablar con una instancia de GitLab (self-hosted o gitlab.com).

Usamos httpx directamente contra la API REST v4 en lugar de python-gitlab
para tener control fino sobre paginación, timeouts y manejo de errores,
y para que el resto del código no dependa de una librería externa pesada.
"""
from __future__ import annotations

import asyncio
import base64
import logging
from dataclasses import dataclass
from urllib.parse import quote

import httpx

logger = logging.getLogger(__name__)


class GitLabAuthError(Exception):
    """Token inválido o sin permisos suficientes."""


class GitLabNotFoundError(Exception):
    """El proyecto, branch o archivo no existe."""


class GitLabRateLimitError(Exception):
    """GitLab rate limit exceeded after all retries."""


@dataclass
class GitLabFile:
    path: str
    size: int


@dataclass
class GitLabProject:
    id: str
    path_with_namespace: str
    name: str
    description: str
    default_branch: str
    last_commit_sha: str


class GitLabClient:
    """
    Cliente mínimo y robusto para la API v4 de GitLab.
    Soporta cualquier instancia self-hosted: solo cambia `base_url`.

    Reutiliza un único AsyncClient para todas las peticiones, lo que evita
    el overhead de TCP+TLS por llamada. Usar como context manager (async with)
    o llamar a close() cuando se termina de usar.
    """

    def __init__(self, base_url: str, private_token: str, timeout: float = 30.0, max_retries: int = 4):
        self.base_url = base_url.rstrip("/")
        self.api_url = f"{self.base_url}/api/v4"
        self._max_retries = max_retries
        self._http = httpx.AsyncClient(
            headers={"PRIVATE-TOKEN": private_token},
            timeout=timeout,
        )

    async def close(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> "GitLabClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.close()

    async def _get(self, url: str, params: dict | None = None) -> httpx.Response:
        for attempt in range(self._max_retries + 1):
            resp = await self._http.get(url, params=params)
            if resp.status_code == 429:
                if attempt < self._max_retries:
                    wait = int(resp.headers.get("Retry-After", 2 ** attempt))
                    logger.warning(
                        "GitLab rate limit on %s; retrying in %ds (attempt %d/%d)",
                        url, wait, attempt + 1, self._max_retries,
                    )
                    await asyncio.sleep(wait)
                    continue
                raise GitLabRateLimitError(
                    f"GitLab rate limit exceeded after {self._max_retries} retries for {url}"
                )
            if resp.status_code == 401:
                raise GitLabAuthError("Token inválido, expirado o sin permisos suficientes (scope read_api/read_repository).")
            if resp.status_code == 404:
                raise GitLabNotFoundError(f"Recurso no encontrado en GitLab: {url}")
            resp.raise_for_status()
            return resp
        raise GitLabRateLimitError(f"GitLab rate limit exceeded after {self._max_retries} retries for {url}")

    async def get_project(self, project_path: str) -> GitLabProject:
        """project_path puede ser 'grupo/subgrupo/proyecto' (se URL-encodea)."""
        encoded = quote(project_path, safe="")
        resp = await self._get(f"{self.api_url}/projects/{encoded}")
        data = resp.json()

        last_commit_sha = ""
        try:
            branch_resp = await self._get(
                f"{self.api_url}/projects/{data['id']}/repository/branches/{quote(data['default_branch'], safe='')}"
            )
            last_commit_sha = branch_resp.json().get("commit", {}).get("id", "")
        except Exception as e:
            logger.warning("No se pudo obtener el SHA del último commit para '%s': %s", project_path, e)

        return GitLabProject(
            id=str(data["id"]),
            path_with_namespace=data["path_with_namespace"],
            name=data["name"],
            description=data.get("description") or "",
            default_branch=data.get("default_branch") or "main",
            last_commit_sha=last_commit_sha,
        )

    async def list_repository_tree(self, project_id: str, branch: str, max_files: int) -> list[GitLabFile]:
        """
        Lista TODOS los archivos del repo (recursivo), paginando.
        Se detiene si supera max_files para no explotar el indexado en monorepos gigantes.
        """
        files: list[GitLabFile] = []
        page = 1
        per_page = 100
        while True:
            resp = await self._get(
                f"{self.api_url}/projects/{project_id}/repository/tree",
                params={"recursive": "true", "ref": branch, "per_page": per_page, "page": page},
            )
            items = resp.json()
            if not items:
                break
            for item in items:
                if item.get("type") == "blob":
                    files.append(GitLabFile(path=item["path"], size=0))
            if len(files) >= max_files:
                files = files[:max_files]
                break
            next_page = resp.headers.get("x-next-page")
            if not next_page:
                break
            page = int(next_page)
        return files

    async def get_file_content(self, project_id: str, file_path: str, branch: str) -> str | None:
        """Devuelve el contenido decodificado de un archivo, o None si no es texto/decodificable."""
        encoded_path = quote(file_path, safe="")
        try:
            resp = await self._get(
                f"{self.api_url}/projects/{project_id}/repository/files/{encoded_path}",
                params={"ref": branch},
            )
        except GitLabNotFoundError:
            return None
        data = resp.json()
        content_b64 = data.get("content", "")
        try:
            raw = base64.b64decode(content_b64)
            return raw.decode("utf-8")
        except (UnicodeDecodeError, ValueError):
            return None  # binario o encoding no soportado
