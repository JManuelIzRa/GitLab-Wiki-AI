"""Tests for wiki_exporter.export_wiki_to_markdown using plain SimpleNamespace objects."""

import sys

sys.path.insert(0, ".")

from types import SimpleNamespace

from app.services.wiki_exporter import export_wiki_to_markdown

_REPO = SimpleNamespace(
    name="demo-project",
    project_path="demo-group/demo-project",
    gitlab_url="http://127.0.0.1:9000",
    default_branch="main",
    last_commit_sha="abc1234567890",
)

_PAGES = [
    SimpleNamespace(
        title="Overview",
        parent_slug="",
        content_markdown="## Resumen\nEsto es un proyecto demo.",
        source_files=["README.md"],
    ),
    SimpleNamespace(
        title="Arquitectura",
        parent_slug="",
        content_markdown="## Arquitectura\nPatrón router-controller.",
        source_files=[],
    ),
    SimpleNamespace(
        title="Módulo: src",
        parent_slug="modules",
        content_markdown="## Módulo src\nContiene el entrypoint.",
        source_files=["src/index.js"],
    ),
]


def _get_markdown():
    return export_wiki_to_markdown(_REPO, _PAGES)


def test_export_header_and_metadata():
    md = _get_markdown()
    assert "# Wiki: demo-project" in md
    assert "demo-group/demo-project" in md
    assert "abc1234567890" in md


def test_export_index_links():
    md = _get_markdown()
    assert "## Índice" in md
    assert "[Overview](#overview)" in md
    assert "[Arquitectura](#arquitectura)" in md
    assert "[Módulo: src](#módulo-src)" in md


def test_export_page_content():
    md = _get_markdown()
    assert "# Overview" in md
    assert "Esto es un proyecto demo." in md
    assert "Archivos fuente: README.md" in md
    assert "# Módulo: src" in md


def test_export_subsections_preserved():
    md = _get_markdown()
    overview_section = md.split("# Overview")[1].split("---")[0]
    assert "## Resumen" in overview_section


def test_export_modules_indented_in_index():
    md = _get_markdown()
    index_section = md.split("## Índice")[1].split("---")[0]
    assert "  - [Módulo: src]" in index_section
