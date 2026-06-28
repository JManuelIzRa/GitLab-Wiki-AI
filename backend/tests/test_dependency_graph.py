"""Tests for build_dependency_graph: JS relative imports, Python dotted-path imports."""

import sys

sys.path.insert(0, ".")

from app.services.dependency_graph import build_dependency_graph

_JS_FILES = {
    "src/index.js": (
        "const usersRouter = require('./api/users');\nconst app = express();\napp.use('/users', usersRouter);\n"
    ),
    "src/api/users.js": (
        "const { findUser, createUser } = require('../utils/userStore');\n"
        "const { logRequest } = require('../utils/logger');\n"
        "module.exports = router;\n"
    ),
    "src/utils/userStore.js": "const users = new Map();\nmodule.exports = { findUser, createUser };\n",
    "src/utils/logger.js": "module.exports = { logRequest: (req) => console.log(req) };\n",
    "tests/users.test.js": "const usersRouter = require('../src/api/users');\ndescribe('users', () => {});\n",
}

_JS_LANGUAGES = {p: "JavaScript" for p in _JS_FILES}

_PY_FILES = {
    "app/api/routes.py": "from app.services.indexer import run_index_job\nfrom app.models.schemas import ChatRequest\n",
    "app/services/indexer.py": "from app.services.gitlab_client import GitLabClient\nimport asyncio\n",
    "app/services/gitlab_client.py": "import httpx\n",
    "app/models/schemas.py": "from pydantic import BaseModel\n",
}

_PY_LANGUAGES = {p: "Python" for p in _PY_FILES}


def test_js_graph_nodes():
    graph = build_dependency_graph(_JS_FILES, _JS_LANGUAGES)
    assert "src" in graph.nodes
    assert "tests" in graph.nodes


def test_js_graph_no_self_edges():
    graph = build_dependency_graph(_JS_FILES, _JS_LANGUAGES)
    assert not any(e.source == e.target for e in graph.edges), "no debe haber auto-referencias"


def test_js_graph_tests_depends_on_src():
    graph = build_dependency_graph(_JS_FILES, _JS_LANGUAGES)
    assert any(e.source == "tests" and e.target == "src" for e in graph.edges), (
        "tests debe depender de src (importa users.js)"
    )


def test_python_graph_two_level_grouping():
    graph = build_dependency_graph(_PY_FILES, _PY_LANGUAGES)
    assert "app/api" in graph.nodes
    assert "app/services" in graph.nodes
    assert "app/models" in graph.nodes
    assert "app" not in graph.nodes, "no debe colapsar todo a un solo nodo 'app'"


def test_python_graph_multiple_imports_per_file():
    graph = build_dependency_graph(_PY_FILES, _PY_LANGUAGES)
    assert any(e.source == "app/api" and e.target == "app/services" for e in graph.edges)
    assert any(e.source == "app/api" and e.target == "app/models" for e in graph.edges), (
        "app/api debe depender de app/models (importa schemas.py)"
    )
