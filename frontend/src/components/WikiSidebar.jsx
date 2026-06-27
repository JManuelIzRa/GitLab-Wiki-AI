import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";

function groupPages(pages) {
  const root = pages.filter((p) => !p.parent_slug);
  const modules = pages.filter((p) => p.parent_slug === "modules");
  return { root, modules };
}

function RepoSettingsPanel({ repository, onClose }) {
  const [systemPrompt, setSystemPrompt] = useState(repository.system_prompt || "");
  const [gitlabToken, setGitlabToken] = useState("");
  const [wikiLanguage, setWikiLanguage] = useState(repository.wiki_language || "");
  const [promptOverridesRaw, setPromptOverridesRaw] = useState(
    repository.prompt_overrides ? JSON.stringify(repository.prompt_overrides, null, 2) : ""
  );
  const [promptOverridesError, setPromptOverridesError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    setPromptOverridesError("");
    let parsedOverrides = null;
    if (promptOverridesRaw.trim()) {
      try {
        parsedOverrides = JSON.parse(promptOverridesRaw);
      } catch {
        setPromptOverridesError("JSON inválido en los overrides de prompt.");
        return;
      }
    }
    setSaving(true);
    setError("");
    try {
      await Promise.all([
        api.setSystemPrompt(repository.id, systemPrompt),
        gitlabToken ? api.setGitLabToken(repository.id, gitlabToken) : Promise.resolve(),
        api.setWikiLanguage(repository.id, wikiLanguage),
        api.setPromptOverrides(repository.id, parsedOverrides),
      ]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message || "Error al guardar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={settingsStyles.overlay}>
      <div style={settingsStyles.panel}>
        <div style={settingsStyles.header}>
          <span style={settingsStyles.title}>Configuración del repo</span>
          <button onClick={onClose} style={settingsStyles.closeBtn}>✕</button>
        </div>

        <label style={settingsStyles.fieldLabel}>
          <span style={settingsStyles.fieldName}>Prompt de sistema personalizado</span>
          <span style={settingsStyles.fieldHint}>
            Reemplaza el prompt de sistema predeterminado del LLM al generar el wiki. Vacío = usar el predeterminado. Requiere re-indexar.
          </span>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            style={settingsStyles.textarea}
            placeholder="Eres un ingeniero senior que documenta repositorios de forma concisa y técnica..."
            rows={5}
          />
        </label>

        <label style={settingsStyles.fieldLabel}>
          <span style={settingsStyles.fieldName}>Token GitLab para webhooks</span>
          <span style={settingsStyles.fieldHint}>
            PAT almacenado en el servidor para re-indexado automático vía webhooks de GitLab. {repository.gitlab_token_set ? "✓ Ya configurado." : "No configurado."}
          </span>
          <input
            type="password"
            value={gitlabToken}
            onChange={(e) => setGitlabToken(e.target.value)}
            style={settingsStyles.input}
            placeholder={repository.gitlab_token_set ? "(dejar vacío para no cambiar)" : "glpat-xxxxxxxxxxxxxxxxxxxx"}
          />
        </label>

        <label style={settingsStyles.fieldLabel}>
          <span style={settingsStyles.fieldName}>Idioma del wiki (por repo)</span>
          <span style={settingsStyles.fieldHint}>
            Código ISO del idioma para generar el wiki de este repo (ej. "en", "fr", "de"). Vacío = usar el idioma global del servidor.
          </span>
          <input
            type="text"
            value={wikiLanguage}
            onChange={(e) => setWikiLanguage(e.target.value)}
            style={settingsStyles.input}
            placeholder="es, en, fr, de, pt… (vacío = global)"
            maxLength={8}
          />
        </label>

        <label style={settingsStyles.fieldLabel}>
          <span style={settingsStyles.fieldName}>Overrides de plantillas de prompt</span>
          <span style={settingsStyles.fieldHint}>
            JSON que sobreescribe claves específicas del prompt (overview, architecture, module, setup). Vacío = usar las plantillas del idioma configurado.
          </span>
          <textarea
            value={promptOverridesRaw}
            onChange={(e) => { setPromptOverridesRaw(e.target.value); setPromptOverridesError(""); }}
            style={{ ...settingsStyles.textarea, fontFamily: "var(--font-mono)", fontSize: 11 }}
            placeholder={'{\n  "overview": "Generate a concise overview…",\n  "setup": "Write setup steps…"\n}'}
            rows={5}
          />
          {promptOverridesError && <div style={{ ...settingsStyles.error, marginTop: 4 }}>{promptOverridesError}</div>}
        </label>

        {error && <div style={settingsStyles.error}>{error}</div>}
        <div style={settingsStyles.actions}>
          <button style={settingsStyles.saveBtn} onClick={handleSave} disabled={saving}>
            {saving ? "Guardando…" : saved ? "✓ Guardado" : "Guardar"}
          </button>
          <button style={settingsStyles.cancelBtn} onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

const settingsStyles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    zIndex: 300,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "flex-end",
  },
  panel: {
    width: 360,
    maxWidth: "90vw",
    height: "100vh",
    overflowY: "auto",
    background: "var(--bg-elevated)",
    borderLeft: "1px solid var(--border-subtle)",
    padding: "24px 18px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    fontFamily: "var(--font-mono)",
    color: "var(--text-primary)",
  },
  closeBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "var(--text-tertiary)",
    fontSize: 14,
    padding: 4,
  },
  fieldLabel: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
  },
  fieldName: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-secondary)",
    fontFamily: "var(--font-mono)",
  },
  fieldHint: {
    fontSize: 11,
    color: "var(--text-tertiary)",
    lineHeight: 1.4,
  },
  textarea: {
    width: "100%",
    background: "var(--bg-elevated-2)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 5,
    padding: "8px 10px",
    fontSize: 12,
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono)",
    resize: "vertical",
    outline: "none",
    lineHeight: 1.5,
    boxSizing: "border-box",
  },
  input: {
    width: "100%",
    background: "var(--bg-elevated-2)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 5,
    padding: "7px 10px",
    fontSize: 12,
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono)",
    outline: "none",
    boxSizing: "border-box",
  },
  error: {
    fontSize: 12,
    color: "var(--accent-red)",
    fontFamily: "var(--font-mono)",
    background: "rgba(192,89,74,0.1)",
    padding: "6px 10px",
    borderRadius: 4,
  },
  actions: {
    display: "flex",
    gap: 8,
  },
  saveBtn: {
    padding: "6px 16px",
    fontSize: 12,
    fontFamily: "var(--font-mono)",
    background: "var(--accent-rust)",
    color: "#1A1410",
    border: "none",
    borderRadius: 5,
    cursor: "pointer",
    fontWeight: 600,
  },
  cancelBtn: {
    padding: "6px 12px",
    fontSize: 12,
    fontFamily: "var(--font-mono)",
    background: "var(--bg-elevated-2)",
    color: "var(--text-secondary)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 5,
    cursor: "pointer",
  },
};

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
    <aside style={styles.sidebar}>
      <div style={styles.repoHeader}>
        <div style={styles.topRow}>
          <button onClick={onReset} style={styles.backBtn} title="Ver todos los repositorios indexados">
            ← mis repos
          </button>
          <div style={{ display: "flex", gap: 4 }}>
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
        <div style={styles.exportRow}>
          <a href={exportUrl} download style={styles.exportBtn} title="Descargar como Markdown">
            ↓ .md
          </a>
          <a href={htmlExportUrl} download style={styles.exportBtn} title="Descargar como HTML">
            ↓ .html
          </a>
          <button
            style={styles.exportBtn}
            title="Imprimir / guardar como PDF"
            onClick={() => window.open(htmlExportUrl, "_blank")?.print?.()}
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
    position: "relative",
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
  searchSpinner: {
    position: "absolute",
    right: 18,
    top: "50%",
    transform: "translateY(-50%)",
    fontSize: 11,
    color: "var(--text-tertiary)",
  },
  searchExcerpt: {
    fontSize: 10.5,
    color: "var(--text-tertiary)",
    fontFamily: "var(--font-serif)",
    lineHeight: 1.4,
    marginTop: 3,
    overflow: "hidden",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    whiteSpace: "normal",
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
