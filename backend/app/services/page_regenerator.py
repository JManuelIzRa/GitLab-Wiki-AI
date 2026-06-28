"""Regenerate one existing wiki page from current GitLab source data."""

from __future__ import annotations

from app.core.config import settings
from app.models.db_models import Repository, WikiPage
from app.services.gitlab_client import GitLabClient
from app.services.structure_analyzer import ModuleInfo, analyze_structure
from app.services.wiki_generator import FileSnippet, WikiGenerator


async def regenerate_page(repo: Repository, page: WikiPage, private_token: str) -> str:
    async with GitLabClient(repo.gitlab_url, private_token) as client:
        project = await client.get_project(repo.project_path)
        branch = repo.default_branch or project.default_branch
        tree = await client.list_repository_tree(project.id, branch, settings.max_files_to_index)
        structure = analyze_structure([item.path for item in tree])
        generator = WikiGenerator(
            language=repo.wiki_language or None,
            prompt_overrides=repo.prompt_overrides or None,
        )
        system_prompt = repo.system_prompt or None

        async def read(path: str | None) -> str | None:
            if not path:
                return None
            return await client.get_file_content(project.id, path, branch)

        try:
            if page.slug == "overview":
                return await generator.generate_overview(
                    project.name, structure, await read(structure.readme_path), system_prompt
                )
            if page.slug == "architecture":
                return await generator.generate_architecture(project.name, structure, system_prompt)
            if page.slug == "setup":
                paths = structure.dependency_manifests[:10]
                snippets: list[FileSnippet] = []
                for path in paths:
                    content = await read(path)
                    if content:
                        snippets.append(FileSnippet(path=path, content=content))
                return await generator.generate_setup_guide(
                    project.name,
                    structure,
                    snippets,
                    await read(structure.readme_path),
                    system_prompt,
                )
            if page.slug.startswith("module-"):
                module = next(
                    (
                        item
                        for item in structure.modules
                        if "module-" + item.path.replace("/", "-").lower() == page.slug
                    ),
                    None,
                )
                if module is None:
                    module_path = page.title.split(":", 1)[-1].strip()
                    module = ModuleInfo(
                        name=module_path.rsplit("/", 1)[-1],
                        path=module_path,
                        file_count=len(page.source_files),
                        sample_files=list(page.source_files),
                    )
                snippets = []
                for path in module.sample_files[: settings.sample_files_per_module]:
                    content = await read(path)
                    if content and len(content.encode()) <= settings.max_file_size_bytes:
                        snippets.append(FileSnippet(path=path, content=content))
                if not snippets:
                    raise ValueError("No readable source files remain for this module page")
                return await generator.generate_module_page(project.name, module, snippets, system_prompt)
            raise ValueError(f"Page '{page.slug}' is not an AI-generated page")
        finally:
            await generator.close()
