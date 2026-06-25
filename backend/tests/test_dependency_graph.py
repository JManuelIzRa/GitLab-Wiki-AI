"""Valida build_dependency_graph con un mini-proyecto JS realista (imports relativos reales)."""
import sys
sys.path.insert(0, ".")

from app.services.dependency_graph import build_dependency_graph

FILE_CONTENTS = {
    "src/index.js": (
        "const usersRouter = require('./api/users');\n"
        "const app = express();\n"
        "app.use('/users', usersRouter);\n"
    ),
    "src/api/users.js": (
        "const { findUser, createUser } = require('../utils/userStore');\n"
        "const { logRequest } = require('../utils/logger');\n"
        "module.exports = router;\n"
    ),
    "src/utils/userStore.js": (
        "const users = new Map();\n"
        "module.exports = { findUser, createUser };\n"
    ),
    "src/utils/logger.js": (
        "module.exports = { logRequest: (req) => console.log(req) };\n"
    ),
    "tests/users.test.js": (
        "const usersRouter = require('../src/api/users');\n"
        "describe('users', () => {});\n"
    ),
}

LANGUAGES = {
    "src/index.js": "JavaScript",
    "src/api/users.js": "JavaScript",
    "src/utils/userStore.js": "JavaScript",
    "src/utils/logger.js": "JavaScript",
    "tests/users.test.js": "JavaScript",
}

graph = build_dependency_graph(FILE_CONTENTS, LANGUAGES)

print("NODES:", graph.nodes)
print("EDGES:")
for e in graph.edges:
    print(f"  {e.source} -> {e.target} (weight={e.weight})")

assert "src" in graph.nodes
assert "tests" in graph.nodes
assert not any(e.source == "src" and e.target == "src" for e in graph.edges), \
    "no debe haber auto-referencias dentro del mismo módulo"

assert any(e.source == "tests" and e.target == "src" for e in graph.edges), \
    "tests debe depender de src (importa users.js)"

print("\n✅ build_dependency_graph detecta módulos y aristas correctamente, sin auto-referencias")

# --- Caso Python: paquete único de primer nivel + múltiples imports en un mismo archivo ---
# Este caso reproduce un bug real encontrado durante el desarrollo: cuando un archivo
# importa de DOS módulos internos distintos (ej. 'from app.services.X' y 'from app.models.Y'),
# ambos imports deben resolverse a SUS archivos correctos, no colapsar al mismo candidato
# por compartir el primer componente del dotted path ('app').
PY_FILES = {
    "app/api/routes.py": "from app.services.indexer import run_index_job\nfrom app.models.schemas import ChatRequest\n",
    "app/services/indexer.py": "from app.services.gitlab_client import GitLabClient\nimport asyncio\n",
    "app/services/gitlab_client.py": "import httpx\n",
    "app/models/schemas.py": "from pydantic import BaseModel\n",
}
PY_LANGUAGES = {p: "Python" for p in PY_FILES}
py_graph = build_dependency_graph(PY_FILES, PY_LANGUAGES)

print("\nPYTHON NODES:", py_graph.nodes)
print("PYTHON EDGES:")
for e in py_graph.edges:
    print(f"  {e.source} -> {e.target} (weight={e.weight})")

# Con un único paquete raíz ("app"), el agrupamiento debe usar 2 niveles, no 1.
assert "app/api" in py_graph.nodes
assert "app/services" in py_graph.nodes
assert "app/models" in py_graph.nodes
assert "app" not in py_graph.nodes, "no debe colapsar todo a un solo nodo 'app'"

# routes.py importa de DOS módulos distintos: ambas aristas deben existir.
assert any(e.source == "app/api" and e.target == "app/services" for e in py_graph.edges), \
    "app/api debe depender de app/services (importa indexer.py)"
assert any(e.source == "app/api" and e.target == "app/models" for e in py_graph.edges), \
    "app/api debe depender de app/models (importa schemas.py) -- este es el caso que reveló el bug"

print("\n✅ Python: múltiples imports en un mismo archivo se resuelven a sus módulos correctos (sin colapsar)")
