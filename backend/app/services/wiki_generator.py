"""
Wiki content generation and chat answers via an OpenAI-compatible LLM endpoint.

Generation strategy:
1. "Overview" page  – README + structure summary + dependency manifests.
2. "Architecture"   – module list + entrypoints + file tree.
3. One page per top-N module: real file samples (budget-capped).
4. "Setup guide"    – dependency manifests + CI/Docker configs + README.

For free-form repo questions (answer_question_rag / stream_answer_question_rag),
RAG is used: the caller supplies code chunks retrieved from Qdrant, and this
module only builds the final prompt and calls the LLM.

Language support: set WIKI_LANGUAGE in config (ISO code, e.g. "es", "en").
Full ES and EN prompt sets live in ``wiki_prompts``; other codes get EN prompts
with the target language injected into the system instruction.
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from typing import AsyncGenerator

import httpx
import openai
from openai import AsyncOpenAI

from app.core.config import settings
from app.services.structure_analyzer import ModuleInfo, RepoStructure
from app.services.vector_store import RetrievedChunk
from app.services.wiki_prompts import get_prompts

logger = logging.getLogger(__name__)


@dataclass
class FileSnippet:
    path: str
    content: str


def _sanitize_mermaid_blocks(content: str) -> str:
    """Post-process LLM output to fix the most common Mermaid syntax errors in generated blocks."""

    def _fix(m: re.Match) -> str:
        code = m.group(1)
        # Strip any nested backtick fences the LLM accidentally inserts
        code = re.sub(r"```+\w*", "", code)
        # Normalize line endings
        code = code.replace("\r\n", "\n").replace("\r", "\n")
        # Decode common HTML entities that break the Mermaid parser
        code = (
            code.replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", '"')
            .replace("&#39;", "'")
        )
        return f"```mermaid\n{code.strip()}\n```"

    return re.sub(r"```mermaid\n(.*?)```", _fix, content, flags=re.DOTALL)


_README_BUDGET_CHARS = 4000
_WIKI_SUMMARY_BUDGET_CHARS = 3000
_GROUP_WIKI_SUMMARY_BUDGET_CHARS = 2000


def _truncate(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n... [truncated] ..."


def _budget_snippets(snippets: list[FileSnippet], max_chars: int) -> str:
    parts = []
    remaining = max_chars
    for s in snippets:
        if remaining <= 0:
            break
        chunk = _truncate(s.content, min(remaining, 8000))
        parts.append(f"### File: `{s.path}`\n```\n{chunk}\n```")
        remaining -= len(chunk)
    return "\n\n".join(parts)


def _format_retrieved_chunks(chunks: list[RetrievedChunk]) -> str:
    if not chunks:
        return "(no relevant code snippets found)"
    parts = []
    for c in chunks:
        parts.append(
            f"### `{c.file_path}` (lines {c.start_line}-{c.end_line}, score {c.score:.2f})\n```\n{c.content}\n```"
        )
    return "\n\n".join(parts)


class WikiGenerator:
    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
        language: str | None = None,
        prompt_overrides: dict | None = None,
    ):
        self._client = AsyncOpenAI(
            base_url=base_url or settings.openai_url,
            api_key=api_key or settings.openai_api_key,
            timeout=httpx.Timeout(60.0),
        )
        self.model = model or settings.openai_chat_model
        effective_lang = language or settings.wiki_language
        base_prompts = get_prompts(effective_lang)
        if prompt_overrides:
            self._p = {**base_prompts, **{k: v for k, v in prompt_overrides.items() if v}}
        else:
            self._p = base_prompts

    async def close(self) -> None:
        await self._client.close()

    # ------------------------------------------------------------------
    # Core LLM call with exponential-backoff retry
    # ------------------------------------------------------------------

    async def _ask(
        self,
        user_prompt: str,
        system_prompt: str | None = None,
        max_tokens: int | None = None,
        system_prompt_override: str | None = None,
        history: list[dict] | None = None,
    ) -> str:
        effective_system = system_prompt_override or (system_prompt if system_prompt is not None else self._p["system"])

        # Hard budget: trim user_prompt so system + user fit within max_chars_per_ai_call.
        # Individual snippet-level truncation already runs upstream; this is the final safety net.
        system_chars = len(effective_system)
        user_budget = max(500, settings.max_chars_per_ai_call - system_chars)
        if len(user_prompt) > user_budget:
            logger.warning(
                "User prompt (%d chars) exceeds budget (%d); truncating before LLM call.",
                len(user_prompt),
                user_budget,
            )
            user_prompt = user_prompt[:user_budget] + "\n... [truncated] ..."

        messages: list[dict] = [{"role": "system", "content": effective_system}]
        if history:
            messages.extend({"role": m["role"], "content": m["content"]} for m in history)
        messages.append({"role": "user", "content": user_prompt})

        _retryable = (openai.APIConnectionError, openai.APITimeoutError, openai.InternalServerError)
        last_exc: Exception | None = None
        for attempt in range(4):
            try:
                response = await self._client.chat.completions.create(
                    model=self.model,
                    max_completion_tokens=max_tokens or settings.max_chat_tokens,
                    messages=messages,
                )
                usage = response.usage
                if usage:
                    logger.debug(
                        "LLM token usage: prompt=%d completion=%d total=%d",
                        usage.prompt_tokens,
                        usage.completion_tokens,
                        usage.total_tokens,
                    )
                return response.choices[0].message.content or ""
            except openai.RateLimitError as exc:
                last_exc = exc
                wait = 2 ** (attempt + 2)
                logger.warning("LLM rate limited (attempt %d/4) — retrying in %ds", attempt + 1, wait)
                await asyncio.sleep(wait)
            except _retryable as exc:
                last_exc = exc
                wait = 2**attempt
                logger.warning("LLM request failed (attempt %d/4): %s — retrying in %ds", attempt + 1, exc, wait)
                await asyncio.sleep(wait)
        raise last_exc  # type: ignore[misc]

    # ------------------------------------------------------------------
    # Wiki page generators
    # ------------------------------------------------------------------

    async def generate_overview(
        self,
        project_name: str,
        structure: RepoStructure,
        readme_content: str | None,
        system_prompt_override: str | None = None,
    ) -> str:
        lang_summary = ", ".join(f"{lang} ({count} files)" for lang, count in list(structure.languages.items())[:8])
        prompt = self._p["overview"].format(
            project_name=project_name,
            total_files=structure.total_files,
            lang_summary=lang_summary or "undetermined",
            package_managers=", ".join(structure.package_managers) or "none detected",
            dependency_manifests=", ".join(structure.dependency_manifests) or "none",
            readme=_truncate(readme_content or "(no README found)", settings.max_chars_per_ai_call),
        )
        return _sanitize_mermaid_blocks(await self._ask(prompt, system_prompt_override=system_prompt_override))

    async def generate_architecture(
        self,
        project_name: str,
        structure: RepoStructure,
        system_prompt_override: str | None = None,
    ) -> str:
        modules_desc = "\n".join(
            f"- `{m.path}` ({m.file_count} files, languages: {', '.join(m.languages) or 'n/a'}). "
            f"Examples: {', '.join(m.sample_files[:5])}"
            for m in structure.modules[:25]
        )
        entrypoints = ", ".join(structure.entrypoints) or "no obvious entry points detected"
        prompt = self._p["architecture"].format(
            project_name=project_name,
            modules_desc=modules_desc,
            entrypoints=entrypoints,
            config_files=", ".join(structure.config_files) or "none",
        )
        return _sanitize_mermaid_blocks(await self._ask(prompt, system_prompt_override=system_prompt_override))

    async def generate_module_page(
        self,
        project_name: str,
        module: ModuleInfo,
        snippets: list[FileSnippet],
        system_prompt_override: str | None = None,
    ) -> str:
        files_context = _budget_snippets(snippets, settings.max_chars_per_ai_call)
        prompt = self._p["module"].format(
            project_name=project_name,
            module_path=module.path,
            file_count=module.file_count,
            languages=", ".join(module.languages) or "n/a",
            files_context=files_context,
        )
        return _sanitize_mermaid_blocks(await self._ask(prompt, system_prompt_override=system_prompt_override))

    async def generate_setup_guide(
        self,
        project_name: str,
        structure: RepoStructure,
        manifest_contents: list[FileSnippet],
        readme_content: str | None,
        system_prompt_override: str | None = None,
    ) -> str:
        manifests_context = _budget_snippets(manifest_contents, settings.max_chars_per_ai_call)
        prompt = self._p["setup"].format(
            project_name=project_name,
            package_managers=", ".join(structure.package_managers) or "none detected",
            config_files=", ".join(structure.config_files) or "none",
            manifests_context=manifests_context or "(no readable manifests found)",
            readme=_truncate(readme_content or "(no README)", _README_BUDGET_CHARS),
        )
        return _sanitize_mermaid_blocks(await self._ask(prompt, system_prompt_override=system_prompt_override))

    # ------------------------------------------------------------------
    # RAG chat — non-streaming and streaming variants
    # ------------------------------------------------------------------

    def _build_rag_prompt(
        self,
        project_name: str,
        question: str,
        retrieved_chunks: list[RetrievedChunk],
        wiki_summary: str = "",
    ) -> str:
        code_context = _format_retrieved_chunks(retrieved_chunks)
        wiki_block = (
            f"--- WIKI SUMMARY ---\n{_truncate(wiki_summary, _WIKI_SUMMARY_BUDGET_CHARS)}\n--- END WIKI SUMMARY ---\n\n"
            if wiki_summary
            else ""
        )
        return self._p["rag_context"].format(
            project_name=project_name,
            wiki_block=wiki_block,
            code_context=_truncate(code_context, settings.max_chars_per_ai_call),
            question=question,
        )

    async def answer_question_rag(
        self,
        project_name: str,
        question: str,
        retrieved_chunks: list[RetrievedChunk],
        wiki_summary: str = "",
        history: list[dict] | None = None,
    ) -> str:
        prompt = self._build_rag_prompt(project_name, question, retrieved_chunks, wiki_summary)
        return await self._ask(prompt, system_prompt=self._p["chat_system"], history=history)

    async def stream_answer_question_rag(
        self,
        project_name: str,
        question: str,
        retrieved_chunks: list[RetrievedChunk],
        wiki_summary: str = "",
        history: list[dict] | None = None,
    ) -> AsyncGenerator[str, None]:
        """Stream answer tokens as they arrive from the LLM. Retries connection (not mid-stream)."""
        prompt = self._build_rag_prompt(project_name, question, retrieved_chunks, wiki_summary)
        messages: list[dict] = [{"role": "system", "content": self._p["chat_system"]}]
        if history:
            messages.extend({"role": m["role"], "content": m["content"]} for m in history)
        messages.append({"role": "user", "content": prompt})

        _retryable = (openai.APIConnectionError, openai.APITimeoutError, openai.InternalServerError)
        stream = None
        last_exc: Exception | None = None
        for attempt in range(3):
            try:
                stream = await self._client.chat.completions.create(
                    model=self.model,
                    max_completion_tokens=settings.max_chat_tokens,
                    messages=messages,
                    stream=True,
                )
                break
            except _retryable as exc:
                last_exc = exc
                if attempt < 2:
                    wait = 2**attempt
                    logger.warning(
                        "Streaming connection failed (attempt %d/3): %s — retrying in %ds", attempt + 1, exc, wait
                    )
                    await asyncio.sleep(wait)
        if stream is None:
            raise last_exc  # type: ignore[misc]

        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta

    # ------------------------------------------------------------------
    # Group-level generation
    # ------------------------------------------------------------------

    async def generate_group_overview(
        self,
        group_name: str,
        repo_summaries: list[dict],
    ) -> str:
        """Generate a high-level overview wiki page for a GitLab group.

        Each entry in repo_summaries should have: name, path, pages (list of {title, content}).
        """
        summaries_text = ""
        for rs in repo_summaries:
            pages_text = "\n".join(
                f"  - **{p['title']}**: {p['content'][:200].strip()}" for p in rs.get("pages", [])[:4]
            )
            summaries_text += f"### {rs['name']} (`{rs['path']}`)\n{pages_text or '(no wiki pages yet)'}\n\n"

        prompt = self._p["group_overview"].format(
            group_name=group_name,
            repo_count=len(repo_summaries),
            repo_summaries=summaries_text or "(no repos with generated wikis yet)",
        )
        return _sanitize_mermaid_blocks(await self._ask(prompt, max_tokens=settings.max_chat_tokens))

    async def answer_group_question_rag(
        self,
        group_name: str,
        repo_names: list[str],
        question: str,
        retrieved_chunks: list[RetrievedChunk],
        group_wiki_summary: str = "",
    ) -> str:
        code_context = _format_retrieved_chunks(retrieved_chunks)
        wiki_block = (
            f"--- GROUP WIKI SUMMARY ---\n{_truncate(group_wiki_summary, _GROUP_WIKI_SUMMARY_BUDGET_CHARS)}\n--- END ---\n\n"
            if group_wiki_summary
            else ""
        )
        template = self._p["group_chat_context"]
        prompt = template.format(
            group_name=group_name,
            repo_list=", ".join(repo_names) or "(none)",
            wiki_block=wiki_block,
            code_context=_truncate(code_context, settings.max_chars_per_ai_call),
            question=question,
        )
        return await self._ask(prompt, system_prompt=self._p["chat_system"])

    async def stream_answer_group_question_rag(
        self,
        group_name: str,
        repo_names: list[str],
        question: str,
        retrieved_chunks: list[RetrievedChunk],
        group_wiki_summary: str = "",
    ) -> AsyncGenerator[str, None]:
        code_context = _format_retrieved_chunks(retrieved_chunks)
        wiki_block = (
            f"--- GROUP WIKI SUMMARY ---\n{_truncate(group_wiki_summary, _GROUP_WIKI_SUMMARY_BUDGET_CHARS)}\n--- END ---\n\n"
            if group_wiki_summary
            else ""
        )
        template = self._p["group_chat_context"]
        prompt = template.format(
            group_name=group_name,
            repo_list=", ".join(repo_names) or "(none)",
            wiki_block=wiki_block,
            code_context=_truncate(code_context, settings.max_chars_per_ai_call),
            question=question,
        )
        messages = [
            {"role": "system", "content": self._p["chat_system"]},
            {"role": "user", "content": prompt},
        ]
        _retryable = (openai.APIConnectionError, openai.APITimeoutError, openai.InternalServerError)
        stream = None
        last_exc: Exception | None = None
        for attempt in range(3):
            try:
                stream = await self._client.chat.completions.create(
                    model=self.model,
                    max_completion_tokens=settings.max_chat_tokens,
                    messages=messages,
                    stream=True,
                )
                break
            except _retryable as exc:
                last_exc = exc
                if attempt < 2:
                    await asyncio.sleep(2**attempt)
        if stream is None:
            raise last_exc  # type: ignore[misc]
        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta
