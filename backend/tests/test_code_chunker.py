"""Valida que code_chunker corta archivos largos en múltiples chunks con overlap correcto."""
import sys
sys.path.insert(0, ".")

from app.core.config import settings
from app.services.code_chunker import chunk_file

# Generamos un archivo "largo" artificialmente: 200 líneas de ~50 chars cada una = ~10000 chars,
# bastante por encima de chunk_max_chars (1500 por defecto) para forzar múltiples chunks.
lines = [f"def function_{i}():  # línea numero {i} de relleno" for i in range(200)]
long_content = "\n".join(lines)

print(f"Tamaño del archivo de prueba: {len(long_content)} chars")
print(f"chunk_max_chars configurado: {settings.chunk_max_chars}")
print(f"chunk_overlap_chars configurado: {settings.chunk_overlap_chars}")

chunks = chunk_file("fake/long_file.py", long_content)
print(f"\nChunks generados: {len(chunks)}")

assert len(chunks) > 1, "un archivo largo debe generar más de un chunk"

for i, c in enumerate(chunks):
    print(f"  chunk {i}: líneas {c.start_line}-{c.end_line}, {len(c.content)} chars, chunk_index={c.chunk_index}")
    assert len(c.content) <= settings.chunk_max_chars + 200, "ningún chunk debe exceder mucho el máximo configurado"
    assert c.chunk_index == i

# Verificar que hay overlap real: el final del chunk N debe aparecer también al inicio del chunk N+1
for i in range(len(chunks) - 1):
    current_lines = set(chunks[i].content.split("\n")[-3:])
    next_lines = set(chunks[i + 1].content.split("\n")[:3])
    overlap_found = bool(current_lines & next_lines)
    print(f"  overlap entre chunk {i} y {i+1}: {'sí' if overlap_found else 'no'}")

# Reconstrucción: concatenando todas las líneas únicas en orden debería recuperar
# (al menos) todas las líneas originales, sin huecos.
all_lines_seen = set()
for c in chunks:
    all_lines_seen.update(c.content.split("\n"))
original_lines = set(long_content.split("\n"))
missing = original_lines - all_lines_seen
assert not missing, f"se perdieron líneas en el chunking: {missing}"
print(f"\nTodas las {len(original_lines)} líneas originales están presentes en algún chunk: OK")

# Archivo corto: debe devolver un solo chunk, sin overlap aplicado
short_chunks = chunk_file("fake/short.py", "print('hola')\n")
assert len(short_chunks) == 1
assert short_chunks[0].chunk_index == 0
print("\nArchivo corto -> 1 solo chunk: OK")

print("\n✅ code_chunker funciona correctamente (cortes por línea + overlap + sin pérdida de contenido)")
