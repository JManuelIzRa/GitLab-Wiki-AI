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

// Las distintas "pantallas" de la app, en el orden en que ocurren naturalmente.
const VIEW = {
  BROWSE: "browse",     // lista de repos ya indexados (pantalla inicial)
  CONNECT: "connect",   // formulario para indexar un repo nuevo
  INDEXING: "indexing",
  WIKI: "wiki",
};

function App() {
  // Restore an in-progress job from localStorage so a browser refresh doesn't lose tracking.
  const [view, setView] = useState(() =>
    localStorage.getItem("activeJobId") ? VIEW.INDEXING : VIEW.BROWSE
  );

  // --- Estado de la lista de repos ya indexados ---
  const [repositories, setRepositories] = useState([]);
  const [browseLoading, setBrowseLoading] = useState(true);
  const [browseError, setBrowseError] = useState("");

  // --- Estado del formulario de conexión / nuevo indexado ---
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

  // --- Estado del wiki actualmente abierto ---
  const [repository, setRepository] = useState(null);
  const [pages, setPages] = useState([]);
  const [activeSlug, setActiveSlug] = useState(null);
  const [activePage, setActivePage] = useState(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);

  const job = useJobPolling(activeJobId);

  // Clear persisted job data when it reaches a terminal state.
  useEffect(() => {
    if (job?.status === "done" || job?.status === "failed") {
      localStorage.removeItem("activeJobId");
      localStorage.removeItem("activeJobPath");
    }
  }, [job?.status]);

  // --- Cargar la lista de repos ya indexados al entrar a la pantalla BROWSE ---

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
    return () => {
      cancelled = true;
    };
  }, [view]);

  // --- Abrir directamente el wiki de un repo ya indexado, sin reindexar ---
  const openExistingRepository = async (repo) => {
    try {
      const structure = await api.getWikiStructure(repo.id);
      setRepository(repo);
      setPages(structure.pages);
      setActiveSlug(structure.pages[0]?.slug || null);
      setView(VIEW.WIKI);
    } catch (err) {
      setBrowseError(err.message || "No se pudo abrir este repositorio.");
    }
  };

  const handleDeleteRepository = async (repoId) => {
    await api.deleteRepository(repoId);
    setRepositories((prev) => prev.filter((r) => r.id !== repoId));
  };

  const handleReindexRepository = (repo) => {
    setReindexPrefill(repo);
    setSubmitError("");
    setView(VIEW.CONNECT);
  };

  // --- Enviar formulario de conexión para indexar un repo nuevo ---
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

  // --- Cuando el job de indexado termina, cargar la estructura del wiki ---
  useEffect(() => {
    if (job?.status === "done" && job.repository_id) {
      api.getWikiStructure(job.repository_id).then((structure) => {
        setRepository(structure.repository);
        setPages(structure.pages);
        const firstSlug = structure.pages[0]?.slug;
        setActiveSlug(firstSlug || null);
        setView(VIEW.WIKI);
      });
    }
  }, [job?.status, job?.repository_id]);

  // --- Cargar el contenido de la página activa del wiki ---
  useEffect(() => {
    if (!repository || !activeSlug) return;
    let cancelled = false;

    async function loadPage() {
      setPageLoading(true);
      try {
        const page = await api.getWikiPage(repository.id, activeSlug);
        if (!cancelled) setActivePage(page);
      } finally {
        if (!cancelled) setPageLoading(false);
      }
    }

    loadPage();
    return () => {
      cancelled = true;
    };
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

  const handleUpdatePage = async (slug, newMarkdown) => {
    const updated = await api.updateWikiPage(repository.id, slug, newMarkdown);
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
          <WikiPageContent page={activePage} onUpdatePage={handleUpdatePage} />
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
