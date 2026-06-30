# DeepWiki for GitLab

> [Español](README.es.md) · English


A functional clone of [DeepWiki](https://deepwiki.com) for **GitLab** repositories (self-hosted or gitlab.com). It indexes a project, analyses its real structure (languages, dependencies, modules) and generates a navigable wiki with AI-written pages based on the actual source code — overview, architecture with diagrams, one page per main module, and an installation/run guide.

```
backend/    FastAPI API: GitLab client, static analysis, AI generation, persistence
frontend/   Angular SPA: connection form, indexing progress, wiki reader
```

### How it works

1. **Connect** a GitLab project by providing the instance URL, project path (`group/project`) and a Personal Access Token.
2. The backend **fetches metadata and the file tree** via the GitLab REST API v4 (no real `git clone` — files are read individually via the API, works equally against self-hosted and gitlab.com).
3. A **static analyser** (no AI) detects languages, dependency managers (package.json, requirements.txt, pom.xml, go.mod, …), groups files into modules by folder and detects entry points.
4. An **LLM** (any OpenAI-compatible server: llama.cpp, vLLM, LM Studio with a local model, or the OpenAI/Anthropic API via proxy) receives that structured context plus the real content of relevant files and generates each wiki page in Markdown, including Mermaid diagrams where applicable.
5. Everything is persisted in SQLite. The **frontend receives job progress in real time via Server-Sent Events** and, when done, shows the wiki with sidebar navigation, Markdown/Mermaid/code rendering, multi-turn chat panel, and code search.

### Requirements

- Python 3.11+
- Node.js 20.19+, 22.13+, or 24+
- [uv](https://docs.astral.sh/uv/) for locked Python dependency management
- OpenAI-compatible LLM and embedding HTTP endpoints (see configuration below)
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
uv sync --dev

cp .env.example .env               # edit with your LLM/embedding URLs

uv run uvicorn app.main:app --reload --port 8000
```

API at `http://localhost:8000`. Interactive docs at `http://localhost:8000/docs`.

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

App at `http://localhost:4200` (with `/api` proxied to `http://localhost:8000`).

### Environment variables (`backend/.env`)

The backend uses an **OpenAI-compatible client**, so you can point it at a local model (llama.cpp, vLLM, LM Studio, Ollama with `--api openai`) or any cloud API that exposes the same contract (OpenAI, Azure OpenAI, OpenRouter, etc.).

| Variable | Description | Default |
|---|---|---|
| `OPENAI_URL` | Base URL of the LLM server | `http://localhost:8000/` |
| `OPENAI_CHAT_MODEL` | Model name (as exposed by the server) | `qwen2.5-3b-instruct-q4_k_m.gguf` |
| `OPENAI_API_KEY` | API key (`not-needed` for local servers) | `not-needed` |
| `EMBEDDING_URL` | OpenAI-compatible HTTP embedding endpoint | `http://localhost:8080/embed` |
| `OPENAI_EMBEDDING_MODEL` | Model name sent to the embedding endpoint | `text-embedding-3-small` |
| `EMBEDDING_API_KEY` | Optional bearer token for embeddings | empty |
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
cd backend && uv run ruff check app tests && uv run ruff format --check app tests
uv run pytest tests/ -x -q

# Frontend tests + lint
cd frontend && npm test -- --watch=false && npm run lint
```
