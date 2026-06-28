FROM python:3.11-slim

WORKDIR /app

# Install locked production dependencies first so this layer remains cacheable.
COPY --from=ghcr.io/astral-sh/uv:0.9.26 /uv /uvx /bin/
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

ENV PATH="/app/.venv/bin:$PATH"

COPY . .

# SQLite DB lives outside the image so it survives restarts
ENV DATABASE_URL=sqlite+aiosqlite:///./data/deepwiki.db

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
