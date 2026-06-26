"""
API router — thin combiner that delegates to focused sub-modules.

Sub-modules:
  _repositories  — indexing, jobs, wiki CRUD, revisions, export, webhooks, delete
  _chat          — semantic code search, RAG chat (streaming + non-streaming)
  _groups        — group indexing, cross-repo search and chat
"""
from fastapi import APIRouter

from app.api._repositories import router as _repo_router
from app.api._chat import router as _chat_router
from app.api._groups import router as _group_router

router = APIRouter(prefix="/api")
router.include_router(_repo_router)
router.include_router(_chat_router)
router.include_router(_group_router)
