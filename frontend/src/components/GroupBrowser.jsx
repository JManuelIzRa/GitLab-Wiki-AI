import { useState } from "react";

/**
 * Lists indexed GitLab groups and offers actions to open, re-index, or delete them.
 */
export function GroupBrowser({ groups, loading, errorMessage, onOpenGroup, onNewGroup, onDeleteGroup, onReindexGroup }) {
  const [deletingId, setDeletingId] = useState(null);

  const handleDelete = async (e, groupId) => {
    e.stopPropagation();
    if (deletingId) return;
    if (!window.confirm("¿Eliminar este grupo indexado? Los repositorios se conservarán.")) return;
    setDeletingId(groupId);
    try {
      await onDeleteGroup(groupId);
    } finally {
      setDeletingId(null);
    }
  };

  const handleReindex = (e, group) => {
    e.stopPropagation();
    onReindexGroup(group);
  };

  return (
    <div>
      {loading && <p style={styles.hint}>Cargando grupos…</p>}
      {errorMessage && <div style={styles.errorBox}>{errorMessage}</div>}

      {!loading && !errorMessage && groups.length === 0 && (
        <div style={styles.emptyState}>
          <p style={styles.hint}>
            Todavía no has indexado ningún grupo. Indexa un grupo de GitLab para generar un wiki
            unificado con búsqueda cross-repo.
          </p>
          <button onClick={onNewGroup} style={styles.submitBtn}>
            Indexar mi primer grupo →
          </button>
        </div>
      )}

      {!loading && groups.length > 0 && (
        <ul style={styles.list}>
          {groups.map((group) => (
            <li key={group.id} style={styles.listItem} onClick={() => onOpenGroup(group)}>
              <div style={styles.itemMain}>
                <div style={styles.itemName}>{group.name || group.group_path}</div>
                <div style={styles.itemPath}>{group.group_path} · {group.gitlab_url}</div>
              </div>
              <div style={styles.itemMeta}>
                <button
                  onClick={(e) => handleReindex(e, group)}
                  style={styles.reindexBtn}
                  title="Reindexar este grupo"
                >
                  reindexar
                </button>
                <button
                  onClick={(e) => handleDelete(e, group.id)}
                  style={styles.deleteBtn}
                  disabled={deletingId === group.id}
                  title="Eliminar este grupo indexado"
                >
                  {deletingId === group.id ? "…" : "eliminar"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const styles = {
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
    color: "var(--accent-on-rust)",
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
    color: "var(--text-error)",
    lineHeight: 1.5,
  },
};
