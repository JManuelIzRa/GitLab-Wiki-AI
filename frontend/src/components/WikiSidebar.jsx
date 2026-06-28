import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { RepoSettingsPanel } from "./RepoSettingsPanel";
import { styles } from "./WikiSidebar.styles";

function groupPages(pages) {
  const root = pages.filter((p) => !p.parent_slug);
  const modules = pages.filter((p) => p.parent_slug === "modules");
  return { root, modules };
}
export function WikiSidebar({
  repository,
  pages,
  activeSlug,
  onSelectPage,
  onReset,
  onOpenSearch,
  onOpenGraph,
  onReindex,
  onOpenHistory,
  mobileOpen,
  onMobileClose,
  theme,
  onToggleTheme,
}) {
  const [filter, setFilter] = useState("");
  const [modulesCollapsed, setModulesCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [wikiSearchResults, setWikiSearchResults] = useState(null);
  const [wikiSearchLoading, setWikiSearchLoading] = useState(false);
  const debounceRef = useRef(null);
  const searchInputRef = useRef(null);
  const exportUrl = api.getExportUrl(repository.id);
  const htmlExportUrl = api.getHtmlExportUrl(repository.id);

  const q = filter.trim().toLowerCase();
  const { root, modules } = groupPages(pages);
  const filterPage = (p) => !q || p.title.toLowerCase().includes(q);
  const filteredRoot = root.filter(filterPage);
  const filteredModules = modules.filter(filterPage);

  // Derived: hide stale results when query is too short without calling setState in effect body
  const displayedResults = q.length >= 2 ? wikiSearchResults : null;
  const displayedLoading = q.length >= 2 && wikiSearchLoading;

  // FTS5 wiki-wide search with 400ms debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < 2) {
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setWikiSearchResults(null);
      setWikiSearchLoading(true);
      try {
        const results = await api.searchWikiText(repository.id, q);
        setWikiSearchResults(results);
      } catch {
        setWikiSearchResults([]);
      } finally {
        setWikiSearchLoading(false);
      }
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [q, repository.id]);

  // '/' key focuses the search input when in the wiki view
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === "Escape" && document.activeElement === searchInputRef.current) {
        setFilter("");
        searchInputRef.current?.blur();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const lastIndexed = repository.updated_at
    ? new Date(repository.updated_at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <>
    <aside style={styles.sidebar} className={`wiki-sidebar${mobileOpen ? " is-open" : ""}`}>
      <div style={styles.repoHeader}>
        <div style={styles.topRow}>
          <button onClick={onReset} style={styles.backBtn} title="Ver todos los repositorios indexados">
            ← mis repos
          </button>
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={onMobileClose} style={styles.themeBtn} className="mobile-close-button" aria-label="Cerrar navegación">✕</button>
            <button
              onClick={() => setShowSettings(true)}
              style={styles.themeBtn}
              title="Configuración del repositorio (prompt, token webhook)"
            >
              ⚙
            </button>
            <button
              onClick={onToggleTheme}
              style={styles.themeBtn}
              title={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
            >
              {theme === "dark" ? "☀" : "☾"}
            </button>
          </div>
        </div>

        <div style={styles.repoName}>{repository.name}</div>
        <div style={styles.repoPath}>{repository.project_path}</div>
        <div style={styles.repoMeta}>
          <span style={styles.branchTag}>{repository.default_branch}</span>
          <span style={styles.shaTag}>{repository.last_commit_sha?.slice(0, 8)}</span>
        </div>
        <div
          style={{
            ...styles.ragTag,
            color: repository.indexed_in_qdrant ? "var(--accent-sage)" : "var(--text-tertiary)",
          }}
          title={
            repository.indexed_in_qdrant
              ? "El código está indexado en Qdrant: las preguntas buscan en el código real"
              : "El código no se pudo indexar en Qdrant: las preguntas usan solo el wiki generado"
          }
        >
          <span style={styles.ragDot}>●</span>
          {repository.indexed_in_qdrant ? "búsqueda semántica activa" : "búsqueda semántica no disponible"}
        </div>

        {lastIndexed && onReindex && (
          <div style={styles.indexedRow}>
            <span style={styles.indexedAt}>indexado {lastIndexed}</span>
            <button style={styles.reindexBtn} onClick={() => onReindex(repository)} title="Volver a indexar este repositorio">
              ↺ reindexar
            </button>
          </div>
        )}

        <button onClick={onOpenSearch} style={styles.actionBtn}>
          ⌕ buscar en el código
        </button>
        <button onClick={onOpenGraph} style={styles.actionBtn}>
          ⊞ grafo de dependencias
        </button>
        <button onClick={onOpenHistory} style={styles.actionBtn}>
          ◷ historial y frescura
        </button>
        <div style={styles.exportRow}>
          <a href={exportUrl} download style={styles.exportBtn} title="Descargar como Markdown">
            ↓ .md
          </a>
          <a href={htmlExportUrl} download style={styles.exportBtn} title="Descargar como HTML">
            ↓ .html
          </a>
          <button
            style={styles.exportBtn}
            title="Imprimir la página actual / guardar como PDF"
            onClick={() => window.print()}
          >
            ⎙ pdf
          </button>
        </div>
      </div>

      <div style={styles.searchWrap}>
        <input
          ref={searchInputRef}
          type="search"
          placeholder="buscar… (tecla /)"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={styles.searchInput}
          aria-label="Buscar en el wiki"
        />
        {displayedLoading && <div style={styles.searchSpinner}>…</div>}
      </div>

      <nav style={styles.nav}>
        {/* FTS5 full-text search results */}
        {displayedResults && displayedResults.length > 0 && (
          <div style={styles.navSection}>
            <div style={styles.navSectionLabel}>resultados en el wiki</div>
            <div style={styles.navGroup}>
              {displayedResults.map((r) => (
                <button
                  key={r.slug}
                  style={{
                    ...styles.navItem,
                    paddingLeft: 14,
                    background: r.slug === activeSlug ? "var(--bg-elevated-2)" : "transparent",
                    color: r.slug === activeSlug ? "var(--accent-rust)" : "var(--text-secondary)",
                    borderLeft: r.slug === activeSlug ? "2px solid var(--accent-rust)" : "2px solid transparent",
                    display: "block",
                    height: "auto",
                    textAlign: "left",
                  }}
                  onClick={() => { onSelectPage(r.slug); setFilter(""); }}
                >
                  <div style={{ fontSize: 12.5, fontFamily: "var(--font-mono)" }}>{r.title}</div>
                  <div style={styles.searchExcerpt}>{r.excerpt}</div>
                </button>
              ))}
            </div>
          </div>
        )}
        {displayedResults && displayedResults.length === 0 && q.length >= 2 && (
          <div style={styles.noResults}>sin resultados para "{q}"</div>
        )}

        {/* Regular page nav (hidden when showing FTS results) */}
        {!displayedResults && (
          <>
            {filteredRoot.length === 0 && filteredModules.length === 0 && (
              <div style={styles.noResults}>sin resultados</div>
            )}

            <div style={styles.navGroup}>
              {filteredRoot.map((page) => (
                <NavItem
                  key={page.slug}
                  page={page}
                  active={page.slug === activeSlug}
                  onClick={() => onSelectPage(page.slug)}
                />
              ))}
            </div>

            {(filteredModules.length > 0 || modules.length > 0) && !q && (
              <div style={styles.navSection}>
                <button
                  style={styles.sectionHeader}
                  onClick={() => setModulesCollapsed((c) => !c)}
                  aria-expanded={!modulesCollapsed}
                >
                  <span style={styles.navSectionLabel}>módulos</span>
                  <span style={styles.collapseIcon}>{modulesCollapsed ? "▶" : "▼"}</span>
                </button>
                {!modulesCollapsed && (
                  <div style={styles.navGroup}>
                    {modules.map((page) => (
                      <NavItem
                        key={page.slug}
                        page={page}
                        active={page.slug === activeSlug}
                        onClick={() => onSelectPage(page.slug)}
                        indent
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {q && filteredModules.length > 0 && (
              <div style={styles.navSection}>
                <div style={styles.navSectionLabel}>módulos</div>
                <div style={styles.navGroup}>
                  {filteredModules.map((page) => (
                    <NavItem
                      key={page.slug}
                      page={page}
                      active={page.slug === activeSlug}
                      onClick={() => onSelectPage(page.slug)}
                      indent
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </nav>

      <div style={styles.keyHint}>
        <span>/</span> buscar · <span>Alt+← / Alt+→</span> navegar · <span>?</span> atajos
      </div>
    </aside>
    {showSettings && (
      <RepoSettingsPanel repository={repository} onClose={() => setShowSettings(false)} />
    )}
  </>
  );
}

function NavItem({ page, active, onClick, indent }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...styles.navItem,
        paddingLeft: indent ? 28 : 14,
        background: active ? "var(--bg-elevated-2)" : "transparent",
        color: active ? "var(--accent-rust)" : "var(--text-secondary)",
        borderLeft: active ? "2px solid var(--accent-rust)" : "2px solid transparent",
      }}
    >
      {page.title}
    </button>
  );
}
