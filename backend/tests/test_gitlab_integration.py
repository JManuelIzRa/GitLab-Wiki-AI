"""
Prueba de integración: valida GitLabClient + structure_analyzer contra el mock server.
No llama a ningún LLM (eso se prueba aparte en test_wiki_generator_openai.py para no depender de un servidor real en cada test).
"""
import asyncio
import sys
sys.path.insert(0, ".")

from app.services.gitlab_client import GitLabClient
from app.services.structure_analyzer import analyze_structure


async def main():
    client = GitLabClient(base_url="http://127.0.0.1:9000", private_token="test-token-123")

    project = await client.get_project("demo-group/demo-project")
    print("PROYECTO:", project)
    assert project.id == "42"
    assert project.name == "demo-project"
    assert project.default_branch == "main"
    assert project.last_commit_sha == "abc1234567890"

    tree = await client.list_repository_tree(project.id, project.default_branch, max_files=400)
    paths = [f.path for f in tree]
    print("ARCHIVOS:", paths)
    assert "README.md" in paths
    assert "src/api/users.js" in paths

    structure = analyze_structure(paths)
    print("LENGUAJES:", structure.languages)
    print("PACKAGE MANAGERS:", structure.package_managers)
    print("MODULOS:", [(m.path, m.file_count) for m in structure.modules])
    print("README:", structure.readme_path)
    assert structure.readme_path == "README.md"
    assert "Node.js / npm" in structure.package_managers
    assert any(m.path == "src" for m in structure.modules)

    readme = await client.get_file_content(project.id, "README.md", project.default_branch)
    print("README CONTENT (primeros 60 chars):", readme[:60])
    assert "Demo Project" in readme

    # Probar 404 con archivo inexistente
    missing = await client.get_file_content(project.id, "no-existe.txt", project.default_branch)
    assert missing is None
    print("Archivo inexistente -> None: OK")

    # Probar auth error
    from app.services.gitlab_client import GitLabAuthError
    bad_client = GitLabClient(base_url="http://127.0.0.1:9000", private_token="token-malo")
    try:
        await bad_client.get_project("demo-group/demo-project")
        print("ERROR: debería haber lanzado GitLabAuthError")
        sys.exit(1)
    except GitLabAuthError:
        print("Token inválido -> GitLabAuthError: OK")

    print("\n✅ TODAS LAS PRUEBAS DE GitLabClient + structure_analyzer PASARON")


if __name__ == "__main__":
    asyncio.run(main())
