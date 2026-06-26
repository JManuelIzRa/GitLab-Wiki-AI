import { useState } from "react";
import { api } from "../api/client";

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
  theme,
  onToggleTheme,
}) {
  const [filter, setFilter] = useState("");
  const [modulesCollapsed, setModulesCollapsed] = useState(false);
  const exportUrl = api.getExportUrl(repository.id);
  const htmlExportUrl = api.getHtmlExportUrl(repository.id);

  const q = filter.trim().toLowerCase();
  const { root, modules } = groupPages(pages);
  const filterPage = (p) => !q || p.title.toLowerCase().includes(q);
  const filteredRoot = root.filter(filterPage);
  const filteredModules = modules.filter(filterPage);

  const lastIndexed = repository.updated_at
    ? new Date(repository.updated_at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <aside style={styles.sidebar}>
      <div style={styles.repoHeader}>
        <div style={styles.topRow}>
          <button onClick={onReset} style={styles.backBtn} title="Ver todos los repositorios indexados">
            ← mis repos
          </button>
          <button
            onClick={onToggleTheme}
            style={styles.themeBtn}
            title={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
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
        <div style={styles.exportRow}>
          <a href={exportUrl} download style={styles.exportBtn}>
            ↓ .md
          </a>
          <a href={htmlExportUrl} download style={styles.exportBtn}>
            ↓ .html
          </a>
        </div>
      </div>

      <div style={styles.searchWrap}>
        <input
          type="search"
          placeholder="filtrar páginas…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={styles.searchInput}
        />
      </div>

      <nav style={styles.nav}>
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
      </nav>

      <div style={styles.keyHint}>
        <span>Alt+← / Alt+→</span> para navegar
      </div>
    </aside>
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

const styles = {
  sidebar: {
    width: 260,
    minWidth: 260,
    height: "100vh",
    borderRight: "1px solid var(--border-subtle)",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-elevated)",
  },
  repoHeader: {
    padding: "18px 14px 12px",
    borderBottom: "1px solid var(--border-subtle)",
  },
  topRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  backBtn: {
    background: "none",
    border: "none",
    color: "var(--text-tertiary)",
    fontSize: 11,
    padding: 0,
    cursor: "pointer",
  },
  themeBtn: {
    background: "var(--bg-elevated-2)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 4,
    padding: "2px 8px",
    fontSize: 13,
    cursor: "pointer",
    color: "var(--text-secondary)",
    lineHeight: 1.4,
  },
  repoName: {
    fontFamily: "var(--font-serif)",
    fontSize: 17,
    fontWeight: 600,
    color: "var(--text-primary)",
    marginBottom: 3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  repoPath: {
    fontSize: 11,
    color: "var(--text-tertiary)",
    marginBottom: 10,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  repoMeta: {
    display: "flex",
    gap: 6,
  },
  branchTag: {
    fontSize: 10.5,
    background: "var(--accent-sage-dim)",
    color: "#D7E5DC",
    padding: "2px 7px",
    borderRadius: 4,
  },
  shaTag: {
    fontSize: 10.5,
    background: "var(--bg-elevated-2)",
    color: "var(--text-tertiary)",
    padding: "2px 7px",
    borderRadius: 4,
  },
  ragTag: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontSize: 10,
    marginTop: 8,
  },
  ragDot: {
    fontSize: 8,
  },
  indexedRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
  },
  indexedAt: {
    fontSize: 10,
    color: "var(--text-tertiary)",
  },
  reindexBtn: {
    background: "none",
    border: "1px solid var(--border-subtle)",
    borderRadius: 4,
    padding: "2px 8px",
    fontSize: 10,
    color: "var(--accent-rust)",
    cursor: "pointer",
  },
  actionBtn: {
    marginTop: 8,
    width: "100%",
    background: "var(--bg-elevated-2)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 6,
    padding: "7px 10px",
    fontSize: 11.5,
    color: "var(--text-secondary)",
    textAlign: "left",
    cursor: "pointer",
  },
  exportRow: {
    display: "flex",
    gap: 6,
    marginTop: 6,
  },
  exportBtn: {
    flex: 1,
    background: "var(--bg-elevated-2)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 6,
    padding: "7px 10px",
    fontSize: 11.5,
    color: "var(--text-secondary)",
    textAlign: "center",
    display: "block",
    textDecoration: "none",
  },
  searchWrap: {
    padding: "8px 10px",
    borderBottom: "1px solid var(--border-subtle)",
  },
  searchInput: {
    width: "100%",
    background: "var(--bg-elevated-2)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 5,
    padding: "5px 9px",
    fontSize: 11.5,
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono)",
    outline: "none",
  },
  nav: {
    flex: 1,
    overflowY: "auto",
    padding: "10px 0",
  },
  noResults: {
    padding: "12px 14px",
    fontSize: 11,
    color: "var(--text-tertiary)",
    fontStyle: "italic",
  },
  navGroup: {
    display: "flex",
    flexDirection: "column",
  },
  navSection: {
    marginTop: 12,
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    background: "none",
    border: "none",
    padding: "2px 14px",
    cursor: "pointer",
  },
  navSectionLabel: {
    fontSize: 10.5,
    letterSpacing: "0.06em",
    color: "var(--text-tertiary)",
  },
  collapseIcon: {
    fontSize: 8,
    color: "var(--text-tertiary)",
  },
  navItem: {
    textAlign: "left",
    border: "none",
    padding: "8px 14px",
    fontSize: 12.5,
    fontFamily: "var(--font-mono)",
    lineHeight: 1.4,
    cursor: "pointer",
    width: "100%",
  },
  keyHint: {
    padding: "8px 12px",
    fontSize: 10,
    color: "var(--text-tertiary)",
    borderTop: "1px solid var(--border-subtle)",
    fontFamily: "var(--font-mono)",
  },
};
