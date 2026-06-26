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

import html as _html
import re
from datetime import datetime, timezone


def _slugify_anchor(title: str) -> str:
    """Genera un ancla de Markdown a partir de un título, igual que lo hacen GitHub/GitLab.

    GitHub/GitLab preserve Unicode word characters (letters, digits, _) in anchors and
    only strip punctuation/symbols, so accented titles like "Módulo: src" become
    "#módulo-src", not "#modulo-src".
    """
    # \w in Python regex (Unicode-aware by default) matches letters, digits and _,
    # including accented characters like ó, ñ, etc.
    cleaned = re.sub(r"[^\w\s-]", "", title.lower())
    return cleaned.strip().replace(" ", "-")


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


_HTML_TEMPLATE = """\
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wiki: {repo_name}</title>
<style>
*{{box-sizing:border-box}}
body{{margin:0;font-family:'Segoe UI',system-ui,sans-serif;background:#16140F;color:#EDE8DC;line-height:1.6}}
a{{color:#C97C4A}}
.sidebar{{position:fixed;top:0;left:0;width:240px;height:100vh;overflow-y:auto;background:#201D17;border-right:1px solid #38332A;padding:20px 12px}}
.sidebar h2{{font-size:14px;color:#C97C4A;margin:0 0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
.sidebar .meta{{font-size:11px;color:#6F6A5C;margin-bottom:16px}}
.sidebar nav a{{display:block;padding:6px 10px;font-size:12px;color:#A39C8C;text-decoration:none;border-radius:4px;border-left:2px solid transparent}}
.sidebar nav a:hover{{background:#2A2620;color:#EDE8DC}}
.sidebar nav a.active{{background:#2A2620;color:#C97C4A;border-left-color:#C97C4A}}
.sidebar .section-label{{font-size:10px;letter-spacing:.06em;color:#6F6A5C;padding:12px 10px 4px;text-transform:uppercase}}
main{{margin-left:240px;padding:48px 64px;max-width:960px}}
h1{{font-size:32px;font-weight:700;margin:0 0 24px;color:#EDE8DC}}
h2{{font-size:20px;font-weight:600;color:#EDE8DC;border-top:1px solid #38332A;padding-top:24px;margin-top:40px}}
h3{{font-size:16px;font-weight:600;color:#EDE8DC;margin-top:24px}}
p{{color:#A39C8C;margin:0 0 16px}}
pre{{background:#201D17;border:1px solid #38332A;border-radius:6px;padding:16px;overflow-x:auto;font-size:12px}}
code{{background:#2A2620;border:1px solid #38332A;border-radius:3px;padding:2px 5px;font-size:.85em;color:#C97C4A}}
pre code{{background:none;border:none;padding:0;color:#EDE8DC}}
blockquote{{border-left:3px solid #C97C4A;margin:16px 0;padding:4px 0 4px 16px;color:#6F6A5C;font-style:italic}}
table{{width:100%;border-collapse:collapse;margin:16px 0;font-size:13px}}
th{{text-align:left;border-bottom:1px solid #4A4438;padding:8px 10px;color:#EDE8DC}}
td{{border-bottom:1px solid #38332A;padding:8px 10px;color:#A39C8C}}
.sources{{margin-top:40px;padding-top:16px;border-top:1px solid #38332A;font-size:11px;color:#6F6A5C}}
.sources span{{display:inline-block;background:#2A2620;border:1px solid #38332A;border-radius:3px;padding:2px 7px;margin:2px;font-family:monospace}}
.page-section{{padding-bottom:64px;border-bottom:1px solid #38332A;margin-bottom:64px}}
.generated{{font-size:11px;color:#6F6A5C;margin-top:4px}}
@media(max-width:700px){{.sidebar{{display:none}}main{{margin-left:0;padding:24px 20px}}}}
</style>
</head>
<body>
<aside class="sidebar">
<h2>{repo_name}</h2>
<div class="meta">{repo_path} &bull; {branch}</div>
<nav>
{nav_items}
</nav>
</aside>
<main>
{page_sections}
<p class="generated">Generado por DeepWiki-GitLab el {generated_at}</p>
</main>
</body>
</html>
"""


def export_wiki_to_html(repository, pages: list) -> str:
    """Render wiki pages as a self-contained HTML file with sidebar navigation."""
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    # Build sidebar nav
    nav_lines = []
    current_section = None
    for page in pages:
        if page.parent_slug and current_section != page.parent_slug:
            current_section = page.parent_slug
            nav_lines.append(f'<div class="section-label">{_html.escape(current_section)}</div>')
        indent = "padding-left:22px;" if page.parent_slug else ""
        nav_lines.append(
            f'<a href="#{_html.escape(page.slug)}" style="{indent}">{_html.escape(page.title)}</a>'
        )

    # Build page sections (markdown rendered as escaped HTML + basic conversions)
    sections = []
    for page in pages:
        content_html = _markdown_to_html(page.content_markdown)
        sources_html = ""
        if page.source_files:
            tags = "".join(f"<span>{_html.escape(f)}</span>" for f in page.source_files)
            sources_html = f'<div class="sources">archivos fuente: {tags}</div>'
        sections.append(
            f'<section class="page-section" id="{_html.escape(page.slug)}">'
            f"<h1>{_html.escape(page.title)}</h1>"
            f"{content_html}"
            f"{sources_html}"
            f"</section>"
        )

    return _HTML_TEMPLATE.format(
        repo_name=_html.escape(repository.name),
        repo_path=_html.escape(repository.project_path),
        branch=_html.escape(repository.default_branch),
        generated_at=generated_at,
        nav_items="\n".join(nav_lines),
        page_sections="\n".join(sections),
    )


def _markdown_to_html(md: str) -> str:
    """Minimal markdown-to-HTML conversion for the HTML export.

    Handles fenced code blocks, inline code, headers, bold/italic, and paragraphs.
    For full rendering, callers should use a proper markdown library.
    """
    lines = md.split("\n")
    out: list[str] = []
    in_code = False
    code_buf: list[str] = []

    for line in lines:
        if line.startswith("```"):
            if in_code:
                lang = ""
                out.append(f"<pre><code>{_html.escape(chr(10).join(code_buf))}</code></pre>")
                code_buf = []
                in_code = False
            else:
                in_code = True
            continue

        if in_code:
            code_buf.append(line)
            continue

        # Headers
        if line.startswith("### "):
            out.append(f"<h3>{_html.escape(line[4:])}</h3>")
        elif line.startswith("## "):
            out.append(f"<h2>{_html.escape(line[3:])}</h2>")
        elif line.startswith("# "):
            out.append(f"<h2>{_html.escape(line[2:])}</h2>")
        elif line.startswith("> "):
            out.append(f"<blockquote>{_html.escape(line[2:])}</blockquote>")
        elif line.strip() == "---":
            out.append("<hr>")
        elif line.strip() == "":
            out.append("")
        else:
            # Inline code: `code`
            escaped = _html.escape(line)
            escaped = re.sub(r"`([^`]+)`", r"<code>\1</code>", escaped)
            # Bold: **text**
            escaped = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", escaped)
            # Italic: *text*
            escaped = re.sub(r"\*([^*]+)\*", r"<em>\1</em>", escaped)
            out.append(f"<p>{escaped}</p>")

    return "\n".join(out)
