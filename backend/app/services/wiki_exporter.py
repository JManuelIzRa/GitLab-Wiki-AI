"""
Exportador del wiki a un único documento Markdown.

Construye un documento autocontenido con:
- Encabezado con metadata del repo (nombre, branch, commit, fecha de generación)
- Tabla de contenidos enlazada a anclas dentro del mismo documento
- Cada página como una sección, en el mismo orden que se muestran en el sidebar
  (páginas raíz primero, luego el grupo de módulos)

No depende de FastAPI ni de la sesión de DB directamente: recibe los objetos ya
cargados, así es testeable de forma aislada y reutilizable si en el futuro se
quiere exportar a otro formato (PDF, HTML) reusando el mismo orden de secciones.
"""
from __future__ import annotations

from datetime import datetime, timezone


def _slugify_anchor(title: str) -> str:
    """Genera un ancla de Markdown a partir de un título, igual que lo hacen GitHub/GitLab."""
    return title.lower().replace(" ", "-").replace(":", "").replace("/", "")


def export_wiki_to_markdown(repository, pages: list) -> str:
    """
    repository: objeto con .name, .project_path, .gitlab_url, .default_branch, .last_commit_sha
    pages: lista de WikiPage ya ordenadas (root primero, luego las de parent_slug == "modules")
    """
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    lines = [
        f"# Wiki: {repository.name}",
        "",
        f"- **Repositorio**: `{repository.project_path}` ({repository.gitlab_url})",
        f"- **Branch**: `{repository.default_branch}`",
        f"- **Commit**: `{repository.last_commit_sha}`",
        f"- **Generado por DeepWiki-GitLab el**: {generated_at}",
        "",
        "## Índice",
        "",
    ]

    for page in pages:
        anchor = _slugify_anchor(page.title)
        indent = "  " if page.parent_slug else ""
        lines.append(f"{indent}- [{page.title}](#{anchor})")

    lines.append("")
    lines.append("---")
    lines.append("")

    for page in pages:
        lines.append(f"# {page.title}")
        lines.append("")
        lines.append(page.content_markdown.strip())
        lines.append("")
        if page.source_files:
            lines.append(f"*Archivos fuente: {', '.join(page.source_files)}*")
            lines.append("")
        lines.append("---")
        lines.append("")

    return "\n".join(lines)
