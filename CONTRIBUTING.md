# Contributing

Thanks for helping improve GitLab Wiki AI.

## Development setup

1. Install Python 3.11+, [uv](https://docs.astral.sh/uv/), and Node.js 20.19+, 22.13+, or 24+.
2. Run `uv sync --dev` from `backend/`.
3. Run `npm ci` from `frontend/`.
4. Copy the `.env.example` files only when you need to run the services locally.

## Before opening a pull request

Run the same checks as CI:

```bash
cd backend
uv run ruff check app tests
uv run ruff format --check app tests
uv run pytest tests/ -x -q

cd ../frontend
npm run lint
npm test -- --watch=false
npm run build
```

Keep changes focused, add tests for behavior changes, and never commit GitLab tokens,
API keys, generated databases, virtual environments, `node_modules`, or build output.

## Pull requests

Describe the problem, the chosen approach, and how the change was verified. Include
screenshots for visible UI changes and call out configuration or migration effects.
