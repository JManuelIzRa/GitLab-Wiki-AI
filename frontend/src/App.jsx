import { lazy, Suspense, useCallback, useEffect, startTransition, useState } from "react";

import { WikiLayout, PageSkeleton } from "./components/WikiLayout";
import { useJobPolling } from "./hooks/useJobPolling";
import { api } from "./api/client";
import { offlineCache } from "./utils/offlineCache";

const lazyNamed = (loader, name) => lazy(() => loader().then((module) => ({ default: module[name] })));
const RepositoryBrowser = lazyNamed(() => import("./components/RepositoryBrowser"), "RepositoryBrowser");
const ConnectForm = lazyNamed(() => import("./components/ConnectForm"), "ConnectForm");
const GroupConnectForm = lazyNamed(() => import("./components/GroupConnectForm"), "GroupConnectForm");
const GroupIndexingProgress = lazyNamed(() => import("./components/GroupIndexingProgress"), "GroupIndexingProgress");
const GroupWikiView = lazyNamed(() => import("./components/GroupWikiView"), "GroupWikiView");
const IndexingProgress = lazyNamed(() => import("./components/IndexingProgress"), "IndexingProgress");

// ---------------------------------------------------------------------------
// View constants
// ---------------------------------------------------------------------------

const VIEW = {
  BROWSE: "browse",
  CONNECT: "connect",
  INDEXING: "indexing",
  WIKI: "wiki",
  GROUP_CONNECT: "group_connect",
  GROUP_INDEXING: "group_indexing",
  GROUP_WIKI: "group_wiki",
};

const REPOS_PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// App root — manages shared state and orchestrates view transitions
// ---------------------------------------------------------------------------

function AppContent() {
  // ---- Theme ----
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);

  // ---- View state ----
  const [view, setView] = useState(() =>
    localStorage.getItem("activeJobId") ? VIEW.INDEXING : VIEW.BROWSE
  );

  // ---- Repository list + pagination ----
  const [repositories, setRepositories] = useState([]);
  const [browseLoading, setBrowseLoading] = useState(true);
  const [browseError, setBrowseError] = useState("");
  const [hasMoreRepos, setHasMoreRepos] = useState(false);
  const [repoLoadingMore, setRepoLoadingMore] = useState(false);

  // ---- Indexing job ----
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState(() => {
    const stored = localStorage.getItem("activeJobId");
    return stored ? parseInt(stored, 10) : null;
  });
  const [projectPathLabel, setProjectPathLabel] = useState(
    () => localStorage.getItem("activeJobPath") || ""
  );
  const [reindexPrefill, setReindexPrefill] = useState(null);

  // ---- Wiki state ----
  const [repository, setRepository] = useState(null);
  const [pages, setPages] = useState([]);
  const [activeSlug, setActiveSlug] = useState(null);
  const [activePage, setActivePage] = useState(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // ---- Group state ----
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsError, setGroupsError] = useState("");
  const [activeGroup, setActiveGroup] = useState(null);
  const [activeGroupJobId, setActiveGroupJobId] = useState(null);
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [reindexGroupPrefill, setReindexGroupPrefill] = useState(null);
  const [groupSubmitError, setGroupSubmitError] = useState("");
  const [isGroupSubmitting, setIsGroupSubmitting] = useState(false);

  const job = useJobPolling(activeJobId);

  // Clear stored job IDs when the job reaches a terminal state.
  useEffect(() => {
    if (job?.status === "done" || job?.status === "failed") {
      localStorage.removeItem("activeJobId");
      localStorage.removeItem("activeJobPath");
    }
  }, [job?.status]);

  // Load repo and group lists when the BROWSE view is shown.
  useEffect(() => {
    if (view !== VIEW.BROWSE) return;
    let cancelled = false;

    async function load() {
      setBrowseLoading(true);
      setBrowseError("");
      setGroupsLoading(true);
      setGroupsError("");
      try {
        const [repoResult, groupResult] = await Promise.allSettled([
          api.listRepositories(0, REPOS_PAGE_SIZE + 1),
          api.listGroups(),
        ]);
        if (!cancelled) {
          let repos;
          if (repoResult.status === "fulfilled") {
            repos = repoResult.value;
            offlineCache.setRepositories(repos);
          } else {
            repos = await offlineCache.getRepositories();
            if (!repos) throw repoResult.reason;
            setBrowseError("Servidor no disponible; mostrando repositorios guardados sin conexión.");
          }
          const hasMore = repos.length > REPOS_PAGE_SIZE;
          setRepositories(hasMore ? repos.slice(0, REPOS_PAGE_SIZE) : repos);
          setHasMoreRepos(hasMore);
          if (groupResult.status === "fulfilled") setGroups(groupResult.value);
          else setGroupsError(groupResult.reason?.message || "No se pudieron cargar los grupos.");
        }
      } catch (err) {
        if (!cancelled) setBrowseError(err.message || "No se pudo cargar la lista de repositorios.");
      } finally {
        if (!cancelled) {
          setBrowseLoading(false);
          setGroupsLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [view]);

  const loadMoreRepositories = useCallback(async () => {
    setRepoLoadingMore(true);
    try {
      const more = await api.listRepositories(repositories.length, REPOS_PAGE_SIZE + 1);
      const hasMore = more.length > REPOS_PAGE_SIZE;
      setRepositories((prev) => [...prev, ...(hasMore ? more.slice(0, REPOS_PAGE_SIZE) : more)]);
      setHasMoreRepos(hasMore);
    } catch (err) {
      setBrowseError(err.message || "No se pudieron cargar más repositorios.");
    } finally {
      setRepoLoadingMore(false);
    }
  }, [repositories.length]);

  // Reflect the active wiki page in the URL hash for deep-linking and browser history.
  useEffect(() => {
    if (view === VIEW.WIKI && activeSlug) {
      const next = `#repo=${repository?.id}&page=${encodeURIComponent(activeSlug)}`;
      if (window.location.hash !== next) {
        window.history.pushState(null, "", next);
      }
    } else if (view !== VIEW.WIKI && window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, [view, activeSlug, repository?.id]);

  // Restore page from hash when entering the wiki (e.g. after browser forward)
  useEffect(() => {
    if (view !== VIEW.WIKI || !pages.length) return;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const slug = params.get("page");
    if (slug) {
      if (pages.find((p) => p.slug === slug)) startTransition(() => setActiveSlug(slug));
    }
  }, [view, pages]);

  // Handle browser back/forward while reading the wiki
  useEffect(() => {
    if (view !== VIEW.WIKI) return;
    const handler = () => {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const slug = params.get("page");
      if (slug) {
        if (pages.find((p) => p.slug === slug)) setActiveSlug(slug);
      }
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [view, pages]);

  // Keyboard navigation between wiki pages (Alt+← / Alt+→) and shortcuts modal (?).
  useEffect(() => {
    if (view !== VIEW.WIKI || !pages.length) return;

    const handler = (e) => {
      if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;

      if (e.key === "?" && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((value) => !value);
        return;
      }

      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        setActiveSlug((slug) => {
          const idx = pages.findIndex((p) => p.slug === slug);
          return idx > 0 ? pages[idx - 1].slug : slug;
        });
      } else if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        setActiveSlug((slug) => {
          const idx = pages.findIndex((p) => p.slug === slug);
          return idx < pages.length - 1 ? pages[idx + 1].slug : slug;
        });
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [view, pages]);

  // ---- Repository handlers ----

  const openExistingRepository = async (repo) => {
    try {
      let structure = null;
      try {
        structure = await api.getWikiStructure(repo.id);
        offlineCache.setStructure(repo.id, structure);
      } catch (netErr) {
        const cached = await offlineCache.getStructure(repo.id);
        if (cached) {
          structure = cached;
        } else {
          throw netErr;
        }
      }
      setRepository(structure.repository ?? repo);
      setPages(structure.pages);
      setActiveSlug(structure.pages[0]?.slug || null);
      setView(VIEW.WIKI);
      localStorage.setItem("lastRepoId", String(repo.id));
    } catch (err) {
      setBrowseError(`Error al abrir "${repo.name}": ${err.message || "Error desconocido"}`);
    }
  };

  useEffect(() => {
    if (view !== VIEW.BROWSE || browseLoading || !repositories.length) return;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const requestedId = Number(params.get("repo"));
    if (!requestedId) return;
    const requested = repositories.find((repo) => repo.id === requestedId);
    if (requested) {
      const timer = window.setTimeout(() => openExistingRepository(requested), 0);
      return () => window.clearTimeout(timer);
    }
  }, [browseLoading, repositories, view]);

  const handleDeleteRepository = async (repoId) => {
    await api.deleteRepository(repoId);
    offlineCache.clearRepo(repoId);
    setRepositories((prev) => prev.filter((r) => r.id !== repoId));
  };

  const handleReindexRepository = (repo) => {
    // Don't clear the cache here — only clear it when the new index completes successfully.
    // Clearing early means a failed re-index leaves the user with no cached content.
    setReindexPrefill(repo);
    setSubmitError("");
    setView(VIEW.CONNECT);
  };

  const handleConnect = async (payload) => {
    setIsSubmitting(true);
    setSubmitError("");
    try {
      const res = await api.indexRepository(payload);
      localStorage.setItem("activeJobId", String(res.job_id));
      localStorage.setItem("activeJobPath", payload.project_path);
      setProjectPathLabel(payload.project_path);
      setActiveJobId(res.job_id);
      setView(VIEW.INDEXING);
    } catch (err) {
      setSubmitError(err.message || "No se pudo iniciar el indexado.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Transition to WIKI view when indexing completes. Clear stale cache first so the
  // user never reads outdated offline content after a successful re-index.
  useEffect(() => {
    if (job?.status === "done" && job.repository_id) {
      offlineCache.clearRepo(job.repository_id).then(() =>
        api.getWikiStructure(job.repository_id)
      ).then((structure) => {
        offlineCache.setStructure(job.repository_id, structure);
        setRepository(structure.repository);
        setPages(structure.pages);
        setActiveSlug(structure.pages[0]?.slug || null);
        setView(VIEW.WIKI);
      });
    }
  }, [job?.status, job?.repository_id]);

  // Load the active wiki page whenever the slug or repository changes.
  useEffect(() => {
    if (!repository || !activeSlug) return;
    let cancelled = false;

    async function loadPage() {
      setPageLoading(true);
      try {
        let page = null;
        try {
          page = await api.getWikiPage(repository.id, activeSlug);
          offlineCache.setPage(repository.id, activeSlug, page);
        } catch (netErr) {
          const cached = await offlineCache.getPage(repository.id, activeSlug);
          if (cached) {
            page = cached;
          } else {
            throw netErr;
          }
        }
        if (!cancelled) setActivePage(page);
      } finally {
        if (!cancelled) setPageLoading(false);
      }
    }

    loadPage();
    return () => { cancelled = true; };
  }, [repository, activeSlug]);

  const handleReset = () => {
    localStorage.removeItem("activeJobId");
    localStorage.removeItem("activeJobPath");
    setView(VIEW.BROWSE);
    setActiveJobId(null);
    setRepository(null);
    setPages([]);
    setActiveSlug(null);
    setActivePage(null);
    setSubmitError("");
    setSearchOpen(false);
    setGraphOpen(false);
    setActiveGroup(null);
    setActiveGroupJobId(null);
    setActiveGroupId(null);
  };

  const handleUpdatePage = async (slug, newMarkdown, preloadedPage = null) => {
    const updated = preloadedPage ?? await api.updateWikiPage(repository.id, slug, newMarkdown);
    offlineCache.setPage(repository.id, slug, updated);
    setActivePage(updated);
  };

  const handleRegeneratePage = async (slug) => {
    try {
      const updated = await api.regenerateWikiPage(repository.id, slug);
      offlineCache.setPage(repository.id, slug, updated);
      setActivePage(updated);
    } catch (error) {
      if (error.status !== 400) throw error;
      const token = window.prompt("GitLab token para regenerar esta página (no se guardará):") || "";
      if (!token) return;
      const updated = await api.regenerateWikiPage(repository.id, slug, token);
      offlineCache.setPage(repository.id, slug, updated);
      setActivePage(updated);
    }
  };

  // ---- Group handlers ----

  const openExistingGroup = async (group) => {
    try {
      let detail = null;
      try {
        detail = await api.getGroup(group.id);
        offlineCache.setGroup(group.id, detail);
      } catch (netErr) {
        const cached = await offlineCache.getGroup(group.id);
        if (cached) {
          detail = cached;
        } else {
          throw netErr;
        }
      }
      setActiveGroup(detail);
      setView(VIEW.GROUP_WIKI);
    } catch (err) {
      setGroupsError(`Error al abrir el grupo "${group.name}": ${err.message || "Error desconocido"}`);
    }
  };

  const handleDeleteGroup = async (groupId) => {
    await api.deleteGroup(groupId);
    offlineCache.clearGroup(groupId);
    setGroups((prev) => prev.filter((g) => g.id !== groupId));
  };

  const handleReindexGroup = (group) => {
    offlineCache.clearGroup(group.id);
    setReindexGroupPrefill(group);
    setGroupSubmitError("");
    setView(VIEW.GROUP_CONNECT);
  };

  const handleGroupConnect = async (payload) => {
    setIsGroupSubmitting(true);
    setGroupSubmitError("");
    try {
      const res = await api.indexGroup(payload);
      setActiveGroupJobId(res.job_id);
      setActiveGroupId(res.group_id);
      setView(VIEW.GROUP_INDEXING);
    } catch (err) {
      setGroupSubmitError(err.message || "No se pudo iniciar el indexado del grupo.");
    } finally {
      setIsGroupSubmitting(false);
    }
  };

  const handleGroupJobDone = async (job) => {
    if (job.group_id) {
      try {
        const detail = await api.getGroup(job.group_id);
        offlineCache.setGroup(job.group_id, detail);
        setActiveGroup(detail);
        setView(VIEW.GROUP_WIKI);
      } catch {
        setView(VIEW.BROWSE);
      }
    } else {
      setView(VIEW.BROWSE);
    }
  };

  // ---- Render ----

  if (view === VIEW.BROWSE) {
    return (
      <RepositoryBrowser
        repositories={repositories}
        loading={browseLoading}
        errorMessage={browseError}
        onOpenRepository={openExistingRepository}
        onNewRepository={() => {
          setReindexPrefill(null);
          setView(VIEW.CONNECT);
        }}
        onDeleteRepository={handleDeleteRepository}
        onReindexRepository={handleReindexRepository}
        hasMoreRepos={hasMoreRepos}
        onLoadMoreRepos={loadMoreRepositories}
        loadingMoreRepos={repoLoadingMore}
        groups={groups}
        groupsLoading={groupsLoading}
        groupsError={groupsError}
        onOpenGroup={openExistingGroup}
        onNewGroup={() => {
          setReindexGroupPrefill(null);
          setGroupSubmitError("");
          setView(VIEW.GROUP_CONNECT);
        }}
        onDeleteGroup={handleDeleteGroup}
        onReindexGroup={handleReindexGroup}
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (view === VIEW.CONNECT) {
    return (
      <ConnectForm
        onSubmit={handleConnect}
        isSubmitting={isSubmitting}
        errorMessage={submitError}
        onBack={() => setView(VIEW.BROWSE)}
        prefill={reindexPrefill}
      />
    );
  }

  if (view === VIEW.INDEXING) {
    return <IndexingProgress job={job} projectPath={projectPathLabel} />;
  }

  if (view === VIEW.GROUP_CONNECT) {
    return (
      <GroupConnectForm
        onSubmit={handleGroupConnect}
        isSubmitting={isGroupSubmitting}
        errorMessage={groupSubmitError}
        onBack={() => setView(VIEW.BROWSE)}
        prefill={reindexGroupPrefill}
      />
    );
  }

  if (view === VIEW.GROUP_INDEXING) {
    return (
      <GroupIndexingProgress
        groupJobId={activeGroupJobId}
        groupId={activeGroupId}
        onDone={handleGroupJobDone}
      />
    );
  }

  if (view === VIEW.GROUP_WIKI && activeGroup) {
    return (
      <GroupWikiView
        group={activeGroup}
        onReset={handleReset}
        onOpenRepository={openExistingRepository}
      />
    );
  }

  return (
    <WikiLayout
      repository={repository}
      pages={pages}
      activeSlug={activeSlug}
      activePage={activePage}
      pageLoading={pageLoading}
      onSelectPage={setActiveSlug}
      onReset={handleReset}
      onReindex={handleReindexRepository}
      onUpdatePage={handleUpdatePage}
      searchOpen={searchOpen}
      graphOpen={graphOpen}
      shortcutsOpen={shortcutsOpen}
      setSearchOpen={setSearchOpen}
      setGraphOpen={setGraphOpen}
      setShortcutsOpen={setShortcutsOpen}
      historyOpen={historyOpen}
      setHistoryOpen={setHistoryOpen}
      paletteOpen={paletteOpen}
      setPaletteOpen={setPaletteOpen}
      theme={theme}
      onToggleTheme={toggleTheme}
      onRegenerate={handleRegeneratePage}
    />
  );
}

function App() {
  return <Suspense fallback={<PageSkeleton />}><AppContent /></Suspense>;
}

export default App;
