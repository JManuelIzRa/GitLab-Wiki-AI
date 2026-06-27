# DeepWiki for GitLab

> [Español](#español) · [English](#english)

---

## English

A functional clone of [DeepWiki](https://deepwiki.com) for **GitLab** repositories (self-hosted or gitlab.com). It indexes a project, analyses its real structure (languages, dependencies, modules) and generates a navigable wiki with AI-written pages based on the actual source code — overview, architecture with diagrams, one page per main module, and an installation/run guide.

```
backend/    FastAPI API: GitLab client, static analysis, AI generation, persistence
frontend/   React + Vite SPA: connection form, indexing progress, wiki reader
```

### How it works

1. **Connect** a GitLab project by providing the instance URL, project path (`group/project`) and a Personal Access Token.
2. The backend **fetches metadata and the file tree** via the GitLab REST API v4 (no real `git clone` — files are read individually via the API, works equally against self-hosted and gitlab.com).
3. A **static analyser** (no AI) detects languages, dependency managers (package.json, requirements.txt, pom.xml, go.mod, …), groups files into modules by folder and detects entry points.
4. An **LLM** (any OpenAI-compatible server: llama.cpp, vLLM, LM Studio with a local model, or the OpenAI/Anthropic API via proxy) receives that structured context plus the real content of relevant files and generates each wiki page in Markdown, including Mermaid diagrams where applicable.
5. Everything is persisted in SQLite. The **frontend receives job progress in real time via Server-Sent Events** and, when done, shows the wiki with sidebar navigation, Markdown/Mermaid/code rendering, multi-turn chat panel, and code search.

### Requirements

- Python 3.11+
- Node.js 18+
- An OpenAI-compatible LLM server for wiki generation and RAG chat (see configuration below)
- A GitLab Personal Access Token with `read_api` and `read_repository` scopes

### Quick start — Docker Compose (recommended)

The fastest way to run the whole stack (backend + frontend + Qdrant):

```bash
cp backend/.env.example backend/.env
# Edit backend/.env — set OPENAI_URL, EMBEDDING_URL, and OPENAI_API_KEY at minimum

docker compose up --build
```

Open **http://localhost:5173**. The LLM and embedding services are external — configure their URLs in `.env`.

### Manual setup

**Backend:**
```bash
cd backend
pip install -r requirements.txt    # or: uv sync

cp .env.example .env               # edit with your LLM/embedding URLs

uvicorn app.main:app --reload --port 8000
```

API at `http://localhost:8000`. Interactive docs at `http://localhost:8000/docs`.

**Frontend:**
```bash
cd frontend
npm install
cp .env.example .env               # defaults to http://localhost:8000
npm run dev
```

App at `http://localhost:5173`.

### Environment variables (`backend/.env`)

The backend uses an **OpenAI-compatible client**, so you can point it at a local model (llama.cpp, vLLM, LM Studio, Ollama with `--api openai`) or any cloud API that exposes the same contract (OpenAI, Azure OpenAI, OpenRouter, etc.).

| Variable | Description | Default |
|---|---|---|
| `OPENAI_URL` | Base URL of the LLM server | `http://localhost:8000/` |
| `OPENAI_CHAT_MODEL` | Model name (as exposed by the server) | `qwen2.5-3b-instruct-q4_k_m.gguf` |
| `OPENAI_API_KEY` | API key (`not-needed` for local servers) | `not-needed` |
| `EMBEDDING_URL` | Embedding service URL (OpenAI-compatible) | `http://localhost:8080/embed` |
| `QDRANT_HOST` / `QDRANT_PORT` | Qdrant host and port | `localhost` / `6333` |
| `DATABASE_URL` | SQLAlchemy connection URL | `sqlite+aiosqlite:///./deepwiki.db` |
| `MAX_FILES_TO_INDEX` | Max files to list per repo | `400` |
| `MAX_CHARS_PER_AI_CALL` | Context budget per LLM call | `24000` |
| `MAX_CONCURRENT_MODULE_GENERATIONS` | Parallel LLM calls for module pages | `3` |
| `WIKI_LANGUAGE` | ISO language code for generated content | `es` |

**OpenAI cloud example:**
```
OPENAI_URL=https://api.openai.com/v1/
OPENAI_CHAT_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-...
MAX_CHARS_PER_AI_CALL=60000
MAX_CONCURRENT_MODULE_GENERATIONS=8
WIKI_LANGUAGE=en
```

### Testing without a real GitLab instance

The project includes a **GitLab API mock** (`backend/tests/mock_gitlab_server.py`) that simulates a small Node.js/Express project. Useful for testing the full flow without real credentials:

```bash
cd backend
python3 tests/mock_gitlab_server.py   # listens on http://127.0.0.1:9000
```

Then in the frontend connection form:
- **GitLab URL**: `http://127.0.0.1:9000`
- **Project path**: `demo-group/demo-project`
- **Token**: `test-token-123`

### Development

```bash
# Backend tests
cd backend && python -m pytest tests/ -x -q

# Frontend tests + lint
cd frontend && npm test -- --run && npm run lint
```

---

## Español

Réplica funcional de [DeepWiki](https://deepwiki.com) para repositorios de **GitLab** (self-hosted o gitlab.com). Indexa un proyecto, analiza su estructura real (lenguajes, dependencias, módulos) y genera un wiki navegable con páginas escritas por IA a partir del código fuente real — overview, arquitectura con diagramas, una página por módulo principal, y una guía de instalación/ejecución.

```
backend/    API en FastAPI: cliente GitLab, análisis estático, generación con IA, persistencia
frontend/   SPA en React + Vite: formulario de conexión, progreso de indexado, lector del wiki
```

### Cómo funciona

1. **Conectas** un proyecto GitLab dando la URL de la instancia, la ruta del proyecto (`grupo/proyecto`) y un Personal Access Token.
2. El backend **clona la metadata y el árbol de archivos** vía la API REST v4 de GitLab (no hace `git clone` real, lee archivos individuales vía API — funciona igual en self-hosted que en gitlab.com).
3. Un **analizador estático** (sin IA) detecta lenguajes, gestores de dependencias (package.json, requirements.txt, pom.xml, go.mod, etc.), agrupa archivos en módulos por carpeta y detecta puntos de entrada.
4. Un **LLM** (cualquier servidor OpenAI-compatible: llama.cpp, vLLM, LM Studio con un modelo local, o la API de OpenAI/Anthropic vía proxy) recibe ese contexto estructurado más el contenido real de los archivos relevantes y genera cada página del wiki en Markdown, incluyendo diagramas Mermaid cuando aplica.
5. Todo se persiste en SQLite. El **frontend recibe el progreso del job en tiempo real vía Server-Sent Events** y, al terminar, muestra el wiki con sidebar de navegación, render de Markdown/Mermaid/código, chat multi-turno y búsqueda semántica sobre el código.

### Requisitos

- Python 3.11+
- Node.js 18+
- Un servidor LLM compatible con la API de OpenAI para generación de wiki y chat RAG
- Un Personal Access Token de GitLab con scopes `read_api` y `read_repository`

### Arranque rápido — Docker Compose (recomendado)

```bash
cp backend/.env.example backend/.env
# Edita backend/.env — configura OPENAI_URL, EMBEDDING_URL y OPENAI_API_KEY

docker compose up --build
```

Abre **http://localhost:5173**. El LLM y el servicio de embeddings son externos; configura sus URLs en `.env`.

### Configuración manual

Ver la sección en inglés para la tabla completa de variables de entorno — las mismas aplican aquí.

### Variables de entorno clave

| Variable | Descripción | Default |
|---|---|---|
| `OPENAI_URL` | URL base del servidor LLM | `http://localhost:8000/` |
| `OPENAI_CHAT_MODEL` | Nombre del modelo | `qwen2.5-3b-instruct-q4_k_m.gguf` |
| `EMBEDDING_URL` | URL del servicio de embeddings | `http://localhost:8080/embed` |
| `WIKI_LANGUAGE` | Código ISO del idioma del wiki | `es` |

### Probar sin GitLab real

```bash
cd backend
python3 tests/mock_gitlab_server.py   # escucha en http://127.0.0.1:9000
```

En el formulario: URL `http://127.0.0.1:9000`, ruta `demo-group/demo-project`, token `test-token-123`.

### Decisiones de diseño relevantes

- **Sin `git clone` real**: se lee el árbol y el contenido de archivos vía la API REST de GitLab. Evita gestionar disco, autenticación de Git y limpieza de workspaces.
- **Análisis estático separado de la IA**: la detección de lenguajes, dependencias y módulos es pura heurística sin IA. Abarata el indexado y le da a los prompts contexto ya estructurado.
- **Presupuesto de contexto explícito**: cada llamada a IA recorta el contenido de archivos a un límite de caracteres configurable.
- **Progreso real, no simulado**: el `IndexJob` se actualiza en cada etapa real del pipeline; si falla, el mensaje de error específico queda visible.
- **Chat multi-turno**: el panel de preguntas mantiene el historial de la conversación y lo envía al LLM en cada turno, permitiendo preguntas de seguimiento.
- **CORS sin credenciales**: la autenticación es por cabecera (token de GitLab), no por cookie, evitando el rechazo de navegadores con `Allow-Origin: *` + credenciales.
