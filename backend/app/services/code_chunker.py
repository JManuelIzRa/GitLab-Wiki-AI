"""
Chunking de código para indexado vectorial, vía CodeSplitter de LlamaIndex (tree-sitter).

A diferencia de un chunker por líneas con overlap fijo, CodeSplitter parsea el código
como AST y corta respetando límites sintácticos (no parte una función ni una clase a
la mitad si puede evitarlo), lo cual produce chunks semánticamente más coherentes para
indexado y búsqueda de código real.

CodeSplitter requiere especificar el LENGUAJE por instancia (no es agnóstico como un
splitter de texto plano), así que mantenemos una instancia cacheada por lenguaje y
extensión -> lenguaje tree-sitter, reutilizando structure_analyzer.EXTENSION_LANGUAGE
como base pero traduciendo a los nombres de gramática que tree-sitter-language-pack
espera (minúsculas, nombres específicos como "tsx" en vez de "TypeScript JSX", etc.).

Archivos en lenguajes sin gramática tree-sitter soportada (YAML, JSON, SQL, etc.) o que
fallan al parsear (sintaxis inválida, archivo no es realmente código) se degradan a un
chunk único con todo el contenido, en vez de perderse silenciosamente — más texto del
necesario en el peor caso es preferible a no indexar nada de ese archivo.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass

from app.core.config import settings

logger = logging.getLogger(__name__)

# Traduce la extensión de archivo al nombre de gramática que espera tree-sitter-language-pack
# (ver https://github.com/Goldziher/tree-sitter-language-pack para la lista completa).
EXTENSION_TO_TREE_SITTER_LANGUAGE: dict[str, str] = {
    ".py": "python",
    ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".ts": "typescript", ".tsx": "tsx",
    ".java": "java",
    ".kt": "kotlin", ".kts": "kotlin",
    ".go": "go",
    ".rs": "rust",
    ".rb": "ruby",
    ".php": "php",
    ".cs": "c_sharp",
    ".cpp": "cpp", ".cc": "cpp", ".cxx": "cpp", ".hpp": "cpp",
    ".c": "c", ".h": "c",
    ".swift": "swift",
    ".scala": "scala",
    ".sh": "bash", ".bash": "bash",
}


@dataclass
class CodeChunk:
    file_path: str
    chunk_index: int          # posición del chunk dentro del archivo (0, 1, 2...)
    start_line: int
    end_line: int
    content: str

    @property
    def chunk_id(self) -> str:
        """Identificador estable usado como id de punto en Qdrant (determinístico, no aleatorio)."""
        return f"{self.file_path}::{self.chunk_index}"


_splitter_cache: dict[str, object] = {}


def _get_code_splitter(language: str, parser=None):
    """
    Instancia (cacheada) de CodeSplitter para un lenguaje tree-sitter dado.

    Si se pasa `parser` explícitamente, se usa ese en vez de dejar que CodeSplitter
    intente resolverlo vía tree_sitter_language_pack (que descarga el manifest de
    gramáticas desde GitHub releases en la primera llamada). Esto permite inyectar
    parsers ya instalados localmente como paquetes individuales (ej. tree-sitter-python)
    para evitar esa dependencia de red, además de ser el mecanismo natural para tests.
    """
    cache_key = f"{language}::{'custom' if parser else 'default'}"
    if cache_key not in _splitter_cache:
        from llama_index.core.node_parser import CodeSplitter

        _splitter_cache[cache_key] = CodeSplitter(
            language=language,
            chunk_lines=settings.code_chunk_lines,
            chunk_lines_overlap=settings.code_chunk_lines_overlap,
            max_chars=settings.code_chunk_max_chars,
            parser=parser,
        )
    return _splitter_cache[cache_key]


def _char_idx_to_line(text: str, char_idx: int) -> int:
    """Convierte un índice de carácter a número de línea (1-indexado)."""
    return text.count("\n", 0, char_idx) + 1


def _fallback_single_chunk(file_path: str, content: str) -> list[CodeChunk]:
    """Usado cuando no hay gramática tree-sitter para el lenguaje, o el parseo falla."""
    line_count = content.count("\n") + 1
    return [CodeChunk(file_path=file_path, chunk_index=0, start_line=1, end_line=line_count, content=content)]


def chunk_file(file_path: str, content: str, language: str | None = None, parser=None) -> list[CodeChunk]:
    """
    Parte el contenido de un archivo en chunks respetando límites sintácticos (AST),
    vía CodeSplitter. Si el lenguaje no tiene gramática tree-sitter soportada, o el
    parseo falla por cualquier motivo, degrada a un único chunk con todo el contenido
    en vez de perder el archivo silenciosamente.

    `parser`: instancia opcional de tree_sitter.Parser ya construida (ej. con
    tree-sitter-python instalado directamente desde PyPI). Si se omite, CodeSplitter
    intenta resolver el parser vía tree_sitter_language_pack, que descarga su manifest
    de gramáticas desde GitHub releases en la primera llamada para ese lenguaje.
    """
    if not content or not content.strip():
        return []

    if language is None:
        ext = os.path.splitext(file_path)[1].lower()
        language = EXTENSION_TO_TREE_SITTER_LANGUAGE.get(ext)

    if language is None:
        return _fallback_single_chunk(file_path, content)

    try:
        splitter = _get_code_splitter(language, parser=parser)
        from llama_index.core import Document

        doc = Document(text=content)
        nodes = splitter.get_nodes_from_documents([doc])
    except Exception as e:  # noqa: BLE001 - parser inexistente, código con sintaxis inválida, etc.
        logger.warning("CodeSplitter falló para '%s' (lenguaje=%s): %s; usando chunk único.",
                        file_path, language, e)
        return _fallback_single_chunk(file_path, content)

    if not nodes:
        return _fallback_single_chunk(file_path, content)

    chunks: list[CodeChunk] = []
    for i, node in enumerate(nodes):
        node_text = node.get_content()
        start_char = getattr(node, "start_char_idx", None)
        if start_char is not None and start_char >= 0:
            start_line = _char_idx_to_line(content, start_char)
            end_line = start_line + node_text.count("\n")
        else:
            # Si LlamaIndex no pudo localizar el chunk dentro del documento original
            # (no debería pasar con CodeSplitter, pero por robustez), no inventamos
            # un rango de línea — usamos 1..N relativo al propio chunk como mejor esfuerzo.
            start_line = 1
            end_line = node_text.count("\n") + 1

        chunks.append(CodeChunk(
            file_path=file_path, chunk_index=i, start_line=start_line, end_line=end_line, content=node_text,
        ))

    return chunks


def chunk_files(file_contents: dict[str, str], parsers_by_language: dict[str, object] | None = None) -> list[CodeChunk]:
    """
    Aplica chunk_file a un diccionario {path: content} y devuelve todos los chunks juntos.

    `parsers_by_language`: mapa opcional {nombre_lenguaje_tree_sitter: parser_instance}
    para inyectar parsers ya instalados localmente (evita depender de la descarga de
    tree_sitter_language_pack para esos lenguajes). Lenguajes no presentes en el mapa
    siguen resolviéndose por la vía normal (tree_sitter_language_pack) o degradan a
    chunk único si esa resolución falla.
    """
    parsers_by_language = parsers_by_language or {}
    all_chunks: list[CodeChunk] = []
    for path, content in file_contents.items():
        ext = os.path.splitext(path)[1].lower()
        language = EXTENSION_TO_TREE_SITTER_LANGUAGE.get(ext)
        parser = parsers_by_language.get(language) if language else None
        all_chunks.extend(chunk_file(path, content, language=language, parser=parser))
    return all_chunks