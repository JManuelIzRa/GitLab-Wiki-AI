import { useState, useEffect } from "react";
import { RepositoryBrowser } from "./components/RepositoryBrowser";
import { ConnectForm } from "./components/ConnectForm";
import { IndexingProgress } from "./components/IndexingProgress";
import { WikiSidebar } from "./components/WikiSidebar";
import { WikiPageContent } from "./components/WikiPageContent";
import { AskPanel } from "./components/AskPanel";
import { CodeSearch } from "./components/CodeSearch";
import { DependencyGraphView } from "./components/DependencyGraphView";
import { useJobPolling } from "./hooks/useJobPolling";
import { api } from "./api/client";
import { offlineCache } from "./utils/offlineCache";

const VIEW = {
  BROWSE: "browse",
  CONNECT: "connect",
  INDEXING: "indexing",
  WIKI: "wiki",
};

function App() {
  const [view, setView] = useState(() =>
    localStorage.getItem("activeJobId") ? VIEW.INDEXING : VIEW.BROWSE
  );

  const [repositories, setRepositories] = useState([]);
  const [browseLoading, setBrowseLoading] = useState(true);
  const [browseError, setBrowseError] = useState("");

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

  const [repository, setRepository] = useState(null);
  const [pages, setPages] = useState([]);
  const [activeSlug, setActiveSlug] = useState(null);
  const [activePage, setActivePage] = useState(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);

  const job = useJobPolling(activeJobId);

  useEffect(() => {
    if (job?.status === "done" || job?.status === "failed") {
      localStorage.removeItem("activeJobId");
      localStorage.removeItem("activeJobPath");
    }
  }, [job?.status]);

  useEffect(() => {
    if (view !== VIEW.BROWSE) return;
    let cancelled = false;

    async function load() {
      setBrowseLoading(true);
      setBrowseError("");
      try {
        const repos = await api.listRepositories();
        if (!cancelled) setRepositories(repos);
      } catch (err) {
        if (!cancelled) setBrowseError(err.message || "No se pudo cargar la lista de repositorios.");
      } finally {
        if (!cancelled) setBrowseLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [view]);

  const openExistingRepository = async (repo) => {
    try {
      let structure = null;
      try {
        structure = await api.getWikiStructure(repo.id);
        // Persist to offline cache for next time
        offlineCache.setStructure(repo.id, structure);
      } catch (netErr) {
        // Network error — try offline cache
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
    } catch (err) {
      setBrowseError(err.message || "No se pudo abrir este repositorio.");
    }
  };

  const handleDeleteRepository = async (repoId) => {
    await api.deleteRepository(repoId);
    offlineCache.clearRepo(repoId);
    setRepositories((prev) => prev.filter((r) => r.id !== repoId));
  };

  const handleReindexRepository = (repo) => {
    offlineCache.clearRepo(repo.id);
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

  useEffect(() => {
    if (job?.status === "done" && job.repository_id) {
      api.getWikiStructure(job.repository_id).then((structure) => {
        offlineCache.setStructure(job.repository_id, structure);
        setRepository(structure.repository);
        setPages(structure.pages);
        const firstSlug = structure.pages[0]?.slug;
        setActiveSlug(firstSlug || null);
        setView(VIEW.WIKI);
      });
    }
  }, [job?.status, job?.repository_id]);

  useEffect(() => {
    if (!repository || !activeSlug) return;
    let cancelled = false;

    async function loadPage() {
      setPageLoading(true);
      try {
        let page = null;
        try {
          page = await api.getWikiPage(repository.id, activeSlug);
          // Cache the freshly-loaded page
          offlineCache.setPage(repository.id, activeSlug, page);
        } catch (netErr) {
          // Network error — serve from offline cache
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
  };

  const handleUpdatePage = async (slug, newMarkdown, preloadedPage = null) => {
    // If a preloaded page was passed (e.g. from a revision restore), skip the API call
    const updated = preloadedPage ?? await api.updateWikiPage(repository.id, slug, newMarkdown);
    offlineCache.setPage(repository.id, slug, updated);
    setActivePage(updated);
  };

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

  // view === VIEW.WIKI
  return (
    <div style={{ display: "flex" }}>
      <WikiSidebar
        repository={repository}
        pages={pages}
        activeSlug={activeSlug}
        onSelectPage={setActiveSlug}
        onReset={handleReset}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenGraph={() => setGraphOpen(true)}
      />
      <main style={{ flex: 1, height: "100vh", overflowY: "auto" }}>
        {pageLoading && !activePage ? (
          <div style={{ padding: 56, color: "var(--text-tertiary)", fontSize: 13 }}>Cargando página…</div>
        ) : (
          <WikiPageContent
            page={activePage}
            repositoryId={repository?.id}
            onUpdatePage={handleUpdatePage}
          />
        )}
      </main>
      {repository && <AskPanel repositoryId={repository.id} ragAvailable={repository.indexed_in_qdrant} />}
      {searchOpen && repository && (
        <CodeSearch
          repositoryId={repository.id}
          ragAvailable={repository.indexed_in_qdrant}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {graphOpen && repository && (
        <DependencyGraphView repositoryId={repository.id} onClose={() => setGraphOpen(false)} />
      )}
    </div>
  );
}

export default App;
