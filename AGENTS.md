# AGENTS.md — DeepWiki for GitLab

## Repo structure

```
backend/    FastAPI app (Python 3.11+, uv-managed)
frontend/   React 19 + Vite 8 SPA (Node 20+)
```

No monorepo tool — just two independent packages in a single repo.

## Entrypoints

- **Backend**: `app.main:app` — run with `uv run uvicorn app.main:app --reload --port 8000`
- **Frontend**: `src/main.jsx` — dev via `npm run dev` (Vite)
- **Docker**: `docker compose up --build` (stack = backend + frontend + Qdrant)

## Key commands

```bash
# Backend setup
cd backend
uv sync --dev                     # install deps (uses uv, not pip)
cp .env.example .env              # edit OPENAI_URL, EMBEDDING_URL, OPENAI_API_KEY
uv run uvicorn app.main:app --reload --port 8000

# Frontend setup
cd frontend
npm install
cp .env.example .env              # VITE_API_BASE_URL defaults to http://localhost:8000
npm run dev                       # http://localhost:5173

# Tests
cd backend && uv run pytest tests/ -x -q           # skips 5 integration tests by default
cd frontend && npm test -- --run && npm run lint   # vitest + eslint

# Pre-PR checks (order matters: backend tests → frontend lint → frontend tests → build)
cd backend   && uv run pytest tests/ -x -q
cd ../frontend && npm run lint && npm test -- --run && npm run build
```

## Python deps

Locked by `uv.lock`. Always use `uv sync` (not `pip install`). In CI/Docker use `uv sync --frozen --no-dev`.

## Testing quirks

- `pytest.ini` sets `asyncio_mode = auto` and ignores 5 integration tests by default (`test_gitlab_integration.py`, `test_code_search_http.py`, `test_full_pipeline.py`, `test_wiki_generator_openai.py`, `test_chat_sources_http.py`). These require external LLM/embedding/Qdrant services.
- Mock servers for testing without real GitLab: `backend/tests/mock_gitlab_server.py` (port 9000), plus `mock_llm_server.py` and `mock_embedding_server.py`.
- Frontend tests use `vitest` with jsdom environment, setup in `src/__tests__/setup.js`.

## Architecture notes

- **No real `git clone`** — reads file tree and content via GitLab REST API v4. Files are fetched individually via HTTP.
- **Static analysis is AI-free** — language detection, dependency parsing, module grouping are heuristic-only. AI is only used for wiki page generation and chat.
- **SSE for streaming** — chat responses stream via Server-Sent Events. nginx config has `proxy_buffering off` for `/api/` to support this.
- **Auth is header-based**, not cookie-based. Middleware uses `allow_credentials=False` to avoid browser rejection with `Allow-Origin: *`.
- **CORS defaults to `["*"]`** — restrict `CORS_ORIGINS` in production.
- **Auto re-indexing** — background task re-indexes stale repos every hour when `REINDEX_STALENESS_HOURS > 0`.
- **Startup cleanup** — fails interrupted `IndexJob`/`GroupIndexJob` rows and removes orphan Qdrant collections on startup.

## Config

- Backend env: `backend/.env` (all vars documented in `.env.example`)
- Frontend env: `frontend/.env` — only `VITE_API_BASE_URL`
- Docker: `VITE_API_BASE_URL=""` (nginx proxies `/api/` to backend)
- LLM and embedding services are external — not part of Docker Compose

## Style conventions

- Python: 4-space indent, Python 3.11+ idioms
- JS/JSX/JSON/YAML: 2-space indent
- LF line endings, UTF-8, trailing final newline
- ESLint flat config (`eslint.config.js`) — no prettier config present
- No TypeScript — plain JSX throughout
