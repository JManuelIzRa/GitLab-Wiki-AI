"""Valida wiki_exporter.export_wiki_to_markdown con páginas y repo simulados (objetos planos)."""
import sys
sys.path.insert(0, ".")

from types import SimpleNamespace

from app.services.wiki_exporter import export_wiki_to_markdown

repo = SimpleNamespace(
    name="demo-project",
    project_path="demo-group/demo-project",
    gitlab_url="http://127.0.0.1:9000",
    default_branch="main",
    last_commit_sha="abc1234567890",
)

pages = [
    SimpleNamespace(
        title="Overview", parent_slug="", content_markdown="## Resumen\nEsto es un proyecto demo.",
        source_files=["README.md"],
    ),
    SimpleNamespace(
        title="Arquitectura", parent_slug="", content_markdown="## Arquitectura\nPatrón router-controller.",
        source_files=[],
    ),
    SimpleNamespace(
        title="Módulo: src", parent_slug="modules", content_markdown="## Módulo src\nContiene el entrypoint.",
        source_files=["src/index.js"],
    ),
]

markdown = export_wiki_to_markdown(repo, pages)
print(markdown)
print("\n" + "=" * 60)

assert "# Wiki: demo-project" in markdown
assert "demo-group/demo-project" in markdown
assert "abc1234567890" in markdown
assert "## Índice" in markdown
assert "[Overview](#overview)" in markdown
assert "[Arquitectura](#arquitectura)" in markdown
assert "[Módulo: src](#módulo-src)" in markdown
assert "# Overview" in markdown
assert "Esto es un proyecto demo." in markdown
assert "Archivos fuente: README.md" in markdown
assert "# Módulo: src" in markdown
# Verificamos que no hay doble-## confuso: el "## Resumen" generado por el LLM dentro
# de la página debe quedar como SUBSECCIÓN de "# Overview", no como otro título de mismo nivel.
overview_section = markdown.split("# Overview")[1].split("---")[0]
assert "## Resumen" in overview_section, "el ## interno del LLM debe sobrevivir como subsección"

# El módulo debe aparecer indentado en el índice (es un sub-item)
index_section = markdown.split("## Índice")[1].split("---")[0]
assert "  - [Módulo: src]" in index_section, "los módulos deben verse indentados en el índice"

print("\n✅ export_wiki_to_markdown genera un documento completo, con índice y anclas correctas")
