"""Shared FastAPI dependency functions."""

from __future__ import annotations

from fastapi import Request

from app.services.wiki_generator import WikiGenerator


def get_wiki_generator(request: Request) -> WikiGenerator:
    return request.app.state.wiki_generator
