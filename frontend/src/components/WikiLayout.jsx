import { lazy, useMemo, useState } from "react";

const lazyNamed = (loader, name) => lazy(() => loader().then((module) => ({ default: module[name] })));

const KeyboardShortcutsModal = lazyNamed(() => import("./KeyboardShortcutsModal"), "KeyboardShortcutsModal");
const WikiSidebar = lazyNamed(() => import("./WikiSidebar"), "WikiSidebar");
const WikiPageContent = lazyNamed(() => import("./WikiPageContent"), "WikiPageContent");
const AskPanel = lazyNamed(() => import("./AskPanel"), "AskPanel");
const CodeSearch = lazyNamed(() => import("./CodeSearch"), "CodeSearch");
const DependencyGraphView = lazyNamed(() => import("./DependencyGraphView"), "DependencyGraphView");
const JobHistoryPanel = lazyNamed(() => import("./JobHistoryPanel"), "JobHistoryPanel");
const CommandPalette = lazyNamed(() => import("./CommandPalette"), "CommandPalette");

// ---------------------------------------------------------------------------
// Page loading skeleton
// ---------------------------------------------------------------------------

export function PageSkeleton() {
  return (
    <div style={skeletonStyles.article}>
      <div style={{ ...skeletonStyles.block, width: "55%", height: 36, marginBottom: 28 }} />
      <div style={{ ...skeletonStyles.block, width: "100%", height: 14, marginBottom: 10 }} />
      <div style={{ ...skeletonStyles.block, width: "92%", height: 14, marginBottom: 10 }} />
      <div style={{ ...skeletonStyles.block, width: "80%", height: 14, marginBottom: 32 }} />
      <div style={{ ...skeletonStyles.block, width: "35%", height: 22, marginBottom: 18 }} />
      <div style={{ ...skeletonStyles.block, width: "100%", height: 14, marginBottom: 10 }} />
      <div style={{ ...skeletonStyles.block, width: "88%", height: 14, marginBottom: 10 }} />
      <div style={{ ...skeletonStyles.block, width: "100%", height: 96, marginBottom: 32 }} />
      <div style={{ ...skeletonStyles.block, width: "40%", height: 22, marginBottom: 18 }} />
      <div style={{ ...skeletonStyles.block, width: "100%", height: 14, marginBottom: 10 }} />
      <div style={{ ...skeletonStyles.block, width: "76%", height: 14 }} />
    </div>
  );
}

const skeletonStyles = {
  article: {
    maxWidth: 720,
    margin: "0 auto",
    padding: "56px 32px 120px",
  },
  block: {
    background: "linear-gradient(90deg, var(--bg-elevated-2) 25%, var(--bg-elevated) 50%, var(--bg-elevated-2) 75%)",
    backgroundSize: "200% 100%",
    animation: "shimmer 1.5s infinite",
    borderRadius: 6,
  },
  loadingBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    background: "var(--bg-elevated-2)",
    zIndex: 10,
    overflow: "hidden",
  },
  loadingBarInner: {
    height: "100%",
    width: "40%",
    background: "var(--accent-rust)",
    animation: "loadingSlide 1.2s ease-in-out infinite",
    borderRadius: 1,
  },
};

// ---------------------------------------------------------------------------
// Wiki layout
// ---------------------------------------------------------------------------

export function WikiLayout({
  repository, pages, activeSlug, activePage, pageLoading,
  onSelectPage, onReset, onReindex, onUpdatePage,
  searchOpen, graphOpen, shortcutsOpen, setSearchOpen, setGraphOpen, setShortcutsOpen,
  historyOpen, setHistoryOpen, paletteOpen, setPaletteOpen,
  theme, onToggleTheme, onRegenerate,
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const paletteActions = useMemo(() => [
    { id: "code-search", label: "Buscar en el código", hint: "acción", run: () => setSearchOpen(true) },
    { id: "graph", label: "Ver grafo de dependencias", hint: "acción", run: () => setGraphOpen(true) },
    { id: "history", label: "Historial de indexado", hint: "acción", run: () => setHistoryOpen(true) },
    { id: "print", label: "Imprimir / guardar como PDF", hint: "acción", run: () => window.print() },
  ], [setGraphOpen, setHistoryOpen, setSearchOpen]);

  return (
    <div className="wiki-layout">
      <button className="mobile-menu-button" onClick={() => setMobileNavOpen(true)} aria-label="Abrir navegación">☰</button>
      {mobileNavOpen && <button className="mobile-nav-backdrop" onClick={() => setMobileNavOpen(false)} aria-label="Cerrar navegación" />}
      <WikiSidebar
        repository={repository}
        pages={pages}
        activeSlug={activeSlug}
        onSelectPage={(slug) => { onSelectPage(slug); setMobileNavOpen(false); }}
        onReset={onReset}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenGraph={() => setGraphOpen(true)}
        onReindex={onReindex}
        onOpenHistory={() => setHistoryOpen(true)}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
        theme={theme}
        onToggleTheme={onToggleTheme}
      />
      <main className="wiki-main">
        {pageLoading && !activePage && <PageSkeleton />}
        {pageLoading && activePage && (
          <div style={skeletonStyles.loadingBar}>
            <div style={skeletonStyles.loadingBarInner} />
          </div>
        )}
        {activePage && (
          <WikiPageContent
            page={activePage}
            repositoryId={repository?.id}
            repository={repository}
            onUpdatePage={onUpdatePage}
            onRegenerate={onRegenerate}
          />
        )}
      </main>
      {repository && (
        <AskPanel repositoryId={repository.id} repository={repository} ragAvailable={repository.indexed_in_qdrant} />
      )}
      {searchOpen && repository && (
        <CodeSearch
          repositoryId={repository.id}
          repository={repository}
          ragAvailable={repository.indexed_in_qdrant}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {graphOpen && repository && (
        <DependencyGraphView repositoryId={repository.id} onClose={() => setGraphOpen(false)} />
      )}
      {shortcutsOpen && (
        <KeyboardShortcutsModal onClose={() => setShortcutsOpen(false)} />
      )}
      {historyOpen && repository && <JobHistoryPanel repository={repository} onClose={() => setHistoryOpen(false)} />}
      <CommandPalette
        open={paletteOpen}
        pages={pages}
        actions={paletteActions}
        onSelectPage={onSelectPage}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  );
}
