"""
Mock de la API de GitLab para pruebas locales sin acceso a red externa.
Simula un proyecto pequeño con README, package.json y dos módulos (src/api, src/utils).
Se levanta en el puerto 9000 y el test apunta el GitLabClient ahí.
"""

import base64

import uvicorn
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse

app = FastAPI()

VALID_TOKEN = "test-token-123"

FILES = {
    "README.md": "# Demo Project\n\nEste es un proyecto de demostración para probar DeepWiki-GitLab.\nEs una API REST simple en Node.js con Express.\n\n## Instalación\n\n```\nnpm install\nnpm start\n```\n",
    "package.json": '{\n  "name": "demo-project",\n  "version": "1.0.0",\n  "main": "src/index.js",\n  "scripts": {"start": "node src/index.js", "test": "jest"},\n  "dependencies": {"express": "^4.18.0"}\n}\n',
    "src/index.js": "const express = require('express');\nconst usersRouter = require('./api/users');\nconst app = express();\napp.use('/users', usersRouter);\napp.listen(3000, () => console.log('Server running on port 3000'));\n",
    "src/api/users.js": "const express = require('express');\nconst router = express.Router();\nconst { findUser, createUser } = require('../utils/userStore');\n\nrouter.get('/:id', (req, res) => {\n  const user = findUser(req.params.id);\n  res.json(user);\n});\n\nrouter.post('/', (req, res) => {\n  const user = createUser(req.body);\n  res.status(201).json(user);\n});\n\nmodule.exports = router;\n",
    "src/utils/userStore.js": "const users = new Map();\n\nfunction findUser(id) {\n  return users.get(id) || null;\n}\n\nfunction createUser(data) {\n  const id = String(users.size + 1);\n  const user = { id, ...data };\n  users.set(id, user);\n  return user;\n}\n\nmodule.exports = { findUser, createUser };\n",
}

PROJECT = {
    "id": 42,
    "path_with_namespace": "demo-group/demo-project",
    "name": "demo-project",
    "description": "Proyecto demo para probar el indexador",
    "default_branch": "main",
}


def check_auth(token: str | None):
    if token != VALID_TOKEN:
        raise HTTPException(status_code=401, detail="401 Unauthorized")


# IMPORTANTE: en FastAPI las rutas se evalúan en orden de declaración, y un converter
# {x:path} en un segmento intermedio puede "tragarse" rutas más específicas declaradas
# después. Por eso aquí declaramos primero las rutas concretas (branches, tree, files)
# y al final la genérica de "obtener proyecto por path".


@app.get("/api/v4/projects/{project_id}/repository/branches/{branch}")
def get_branch(project_id: str, branch: str, private_token: str | None = Header(None, alias="PRIVATE-TOKEN")):
    check_auth(private_token)
    return {"name": branch, "commit": {"id": "abc1234567890"}}


@app.get("/api/v4/projects/{project_id}/repository/tree")
def get_tree(project_id: str, private_token: str | None = Header(None, alias="PRIVATE-TOKEN")):
    check_auth(private_token)
    items = [{"path": p, "type": "blob"} for p in FILES.keys()]
    return JSONResponse(content=items, headers={})  # sin x-next-page -> una sola página


@app.get("/api/v4/projects/{project_id}/repository/files/{file_path:path}")
def get_file(
    project_id: str, file_path: str, ref: str = "main", private_token: str | None = Header(None, alias="PRIVATE-TOKEN")
):
    check_auth(private_token)
    from urllib.parse import unquote

    path = unquote(file_path)
    if path not in FILES:
        raise HTTPException(status_code=404, detail="404 File Not Found")
    content_b64 = base64.b64encode(FILES[path].encode("utf-8")).decode("ascii")
    return {"file_path": path, "content": content_b64, "encoding": "base64"}


@app.get("/api/v4/projects/{project_path:path}")
def get_project(project_path: str, private_token: str | None = Header(None, alias="PRIVATE-TOKEN")):
    check_auth(private_token)
    return PROJECT


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=9000)
