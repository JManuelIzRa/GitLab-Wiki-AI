import { useState } from "react";
import { GroupBrowser } from "./GroupBrowser";

/**
 * Pantalla inicial con dos pestañas: Repositorios y Grupos.
 */
export function RepositoryBrowser({
  repositories, loading, errorMessage, onOpenRepository, onNewRepository, onDeleteRepository, onReindexRepository,
  hasMoreRepos, onLoadMoreRepos, loadingMoreRepos,
  groups, groupsLoading, groupsError, onOpenGroup, onNewGroup, onDeleteGroup, onReindexGroup,
}) {
  const [tab, setTab] = useState("repos");
  const [deletingId, setDeletingId] = useState(null);

  const handleDelete = async (e, repoId) => {
    e.stopPropagation();
    if (deletingId) return;
    setDeletingId(repoId);
    try {
      await onDeleteRepository(repoId);
    } finally {
      setDeletingId(null);
    }
  };

  const handleReindex = (e, repo) => {
    e.stopPropagation();
    onReindexRepository(repo);
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <div style={styles.eyebrow}>
          <span style={styles.dot} />
          atlas
        </div>

        {/* Tab bar */}
        <div style={styles.tabBar}>
          <button
            onClick={() => setTab("repos")}
            style={{ ...styles.tabBtn, ...(tab === "repos" ? styles.tabBtnActive : {}) }}
          >
            Repositorios
          </button>
          <button
            onClick={() => setTab("groups")}
            style={{ ...styles.tabBtn, ...(tab === "groups" ? styles.tabBtnActive : {}) }}
          >
            Grupos
          </button>
        </div>

        {/* ---- Repos tab ---- */}
        {tab === "repos" && (
          <>
            <div style={styles.headerRow}>
              <h1 style={styles.title}>Repositorios indexados</h1>
              <button onClick={onNewRepository} style={styles.newBtn}>
                + indexar nuevo repo
              </button>
            </div>

            {loading && <p style={styles.hint}>Cargando repositorios…</p>}
            {errorMessage && <div style={styles.errorBox}>{errorMessage}</div>}

            {!loading && !errorMessage && repositories.length === 0 && (
              <div style={styles.emptyState}>
                <p style={styles.hint}>
                  Todavía no has indexado ningún repositorio. Conecta uno de GitLab para generar
                  su wiki por primera vez.
                </p>
                <button onClick={onNewRepository} style={styles.submitBtn}>
                  Indexar mi primer repositorio →
                </button>
              </div>
            )}

            {!loading && repositories.length > 0 && (
              <>
                <ul style={styles.list}>
                  {repositories.map((repo) => (
                    <li key={repo.id} style={styles.listItem} onClick={() => onOpenRepository(repo)}>
                      <div style={styles.itemMain}>
                        <div style={styles.itemName}>{repo.name}</div>
                        <div style={styles.itemPath}>{repo.project_path}</div>
                      </div>
                      <div style={styles.itemMeta}>
                        <span style={styles.branchTag}>{repo.default_branch}</span>
                        <span
                          style={{
                            ...styles.ragTag,
                            color: repo.indexed_in_qdrant ? "var(--accent-sage)" : "var(--text-tertiary)",
                          }}
                        >
                          ● {repo.indexed_in_qdrant ? "RAG activo" : "solo wiki"}
                        </span>
                        <button
                          onClick={(e) => handleReindex(e, repo)}
                          style={styles.reindexBtn}
                          title="Comprobar si hay cambios y reindexar si es necesario"
                        >
                          reindexar
                        </button>
                        <button
                          onClick={(e) => handleDelete(e, repo.id)}
                          style={styles.deleteBtn}
                          disabled={deletingId === repo.id}
                          title="Eliminar este repositorio indexado"
                        >
                          {deletingId === repo.id ? "…" : "eliminar"}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                {hasMoreRepos && (
                  <button
                    onClick={onLoadMoreRepos}
                    disabled={loadingMoreRepos}
                    style={styles.loadMoreBtn}
                  >
                    {loadingMoreRepos ? "Cargando…" : "Ver más repositorios"}
                  </button>
                )}
              </>
            )}
          </>
        )}

        {/* ---- Groups tab ---- */}
        {tab === "groups" && (
          <>
            <div style={styles.headerRow}>
              <h1 style={styles.title}>Grupos indexados</h1>
              <button onClick={onNewGroup} style={styles.newBtn}>
                + indexar grupo
              </button>
            </div>
            <GroupBrowser
              groups={groups || []}
              loading={groupsLoading}
              errorMessage={groupsError}
              onOpenGroup={onOpenGroup}
              onNewGroup={onNewGroup}
              onDeleteGroup={onDeleteGroup}
              onReindexGroup={onReindexGroup}
            />
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  wrapper: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "32px 20px",
    background:
      "radial-gradient(circle at 20% 0%, rgba(201,124,74,0.08), transparent 45%), var(--bg-base)",
  },
  card: {
    width: "100%",
    maxWidth: 560,
  },
  tabBar: {
    display: "flex",
    gap: 4,
    marginBottom: 28,
    borderBottom: "1px solid var(--border-subtle)",
    paddingBottom: 0,
  },
  tabBtn: {
    background: "none",
    border: "none",
    borderBottom: "2px solid transparent",
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 500,
    color: "var(--text-tertiary)",
    cursor: "pointer",
    marginBottom: -1,
  },
  tabBtnActive: {
    color: "var(--text-primary)",
    fontWeight: 600,
    borderBottom: "2px solid var(--accent-rust)",
  },
  eyebrow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    letterSpacing: "0.06em",
    color: "var(--text-tertiary)",
    marginBottom: 24,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "var(--accent-rust)",
    display: "inline-block",
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 28,
  },
  title: {
    fontFamily: "var(--font-serif)",
    fontSize: 30,
    fontWeight: 600,
    margin: 0,
    color: "var(--text-primary)",
    letterSpacing: "-0.01em",
  },
  newBtn: {
    background: "var(--bg-elevated-2)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 6,
    padding: "9px 14px",
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--accent-rust)",
    whiteSpace: "nowrap",
    cursor: "pointer",
  },
  hint: {
    fontFamily: "var(--font-serif)",
    fontSize: 15,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
    alignItems: "flex-start",
  },
  submitBtn: {
    background: "var(--accent-rust)",
    border: "none",
    borderRadius: 6,
    padding: "13px 18px",
    fontSize: 14,
    fontWeight: 600,
    color: "#1A1410",
    cursor: "pointer",
  },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  listItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 8,
    padding: "14px 16px",
    cursor: "pointer",
  },
  itemMain: {
    minWidth: 0,
    overflow: "hidden",
  },
  itemName: {
    fontFamily: "var(--font-serif)",
    fontSize: 16,
    fontWeight: 600,
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  itemPath: {
    fontSize: 11.5,
    color: "var(--text-tertiary)",
    marginTop: 2,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  itemMeta: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexShrink: 0,
  },
  branchTag: {
    fontSize: 10.5,
    background: "var(--bg-elevated-2)",
    color: "var(--text-secondary)",
    padding: "2px 7px",
    borderRadius: 4,
  },
  ragTag: {
    fontSize: 10.5,
    whiteSpace: "nowrap",
  },
  reindexBtn: {
    background: "none",
    border: "1px solid var(--border-subtle)",
    borderRadius: 4,
    color: "var(--text-secondary)",
    fontSize: 10.5,
    padding: "4px 8px",
    cursor: "pointer",
  },
  deleteBtn: {
    background: "none",
    border: "none",
    color: "var(--text-tertiary)",
    fontSize: 11,
    padding: "4px 6px",
    cursor: "pointer",
  },
  errorBox: {
    background: "rgba(192,89,74,0.12)",
    border: "1px solid var(--accent-red)",
    borderRadius: 6,
    padding: "10px 12px",
    fontSize: 12.5,
    color: "#E5A99A",
    lineHeight: 1.5,
  },
  loadMoreBtn: {
    marginTop: 12,
    width: "100%",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 6,
    padding: "9px 14px",
    fontSize: 12,
    color: "var(--text-secondary)",
    cursor: "pointer",
    fontFamily: "var(--font-mono)",
  },
};
