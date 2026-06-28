from app.api._cache import cache_key
from app.api._repositories import router as repository_router


def test_chat_cache_key_includes_history():
    first = cache_key("What does it do?", [{"role": "user", "content": "module A"}])
    second = cache_key("What does it do?", [{"role": "user", "content": "module B"}])
    assert first != second


def test_wiki_search_has_non_conflicting_route():
    paths = {route.path for route in repository_router.routes}
    assert "/repositories/{repo_id}/wiki-search" in paths
