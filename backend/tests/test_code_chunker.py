"""Tests for code_chunker: long-file splitting, overlap, no lost lines, short-file passthrough."""

import sys

sys.path.insert(0, ".")

from app.core.config import settings
from app.services.code_chunker import chunk_file

_LONG_CONTENT = "\n".join(f"def function_{i}():  # línea numero {i} de relleno" for i in range(200))


def test_long_file_produces_multiple_chunks():
    chunks = chunk_file("fake/long_file.py", _LONG_CONTENT)
    assert len(chunks) > 1, "un archivo largo debe generar más de un chunk"


def test_long_file_chunk_sizes_within_limit():
    chunks = chunk_file("fake/long_file.py", _LONG_CONTENT)
    for i, c in enumerate(chunks):
        assert len(c.content) <= settings.code_chunk_max_chars + 200
        assert c.chunk_index == i


def test_long_file_no_lost_lines():
    chunks = chunk_file("fake/long_file.py", _LONG_CONTENT)
    all_lines = set()
    for c in chunks:
        all_lines.update(c.content.split("\n"))
    missing = set(_LONG_CONTENT.split("\n")) - all_lines
    assert not missing, f"se perdieron líneas en el chunking: {missing}"


def test_short_file_single_chunk():
    chunks = chunk_file("fake/short.py", "print('hola')\n")
    assert len(chunks) == 1
    assert chunks[0].chunk_index == 0
