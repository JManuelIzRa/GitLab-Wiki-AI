import { useEffect, useState } from "react";
import { RotateCcw, Upload, X } from "lucide-react";
import { api } from "../api/client";

// ---------------------------------------------------------------------------
// Line-level diff (no external dep)
// ---------------------------------------------------------------------------

function computeLineDiff(aText, bText) {
  const aLines = aText.split("\n");
  const bLines = bText.split("\n");
  const m = aLines.length;
  const n = bLines.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = aLines[i - 1] === bLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  let i = m; let j = n;
  const ops = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aLines[i - 1] === bLines[j - 1]) {
      ops.push({ type: "eq", line: aLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: "add", line: bLines[j - 1] });
      j--;
    } else {
      ops.push({ type: "del", line: aLines[i - 1] });
      i--;
    }
  }
  return ops.reverse();
}

// ---------------------------------------------------------------------------
// Diff view
// ---------------------------------------------------------------------------

function DiffView({ currentContent, revisionContent, onClose }) {
  const ops = computeLineDiff(revisionContent, currentContent);
  const added = ops.filter((o) => o.type === "add").length;
  const deleted = ops.filter((o) => o.type === "del").length;

  return (
    <div style={styles.diffOverlay}>
      <div style={styles.diffPanel}>
        <div style={styles.revisionHeader}>
          <span style={styles.revisionTitle}>
            Diferencias · <span style={{ color: "var(--accent-sage)" }}>+{added}</span>{" "}
            <span style={{ color: "var(--accent-red)" }}>-{deleted}</span>
          </span>
          <button onClick={onClose} style={styles.closeBtn}><X size={14} /></button>
        </div>
        <div style={styles.diffBody}>
          {ops.map((op, idx) => (
            <div
              key={idx}
              style={{
                ...styles.diffLine,
                ...(op.type === "add" ? styles.diffAdd : op.type === "del" ? styles.diffDel : {}),
              }}
            >
              <span style={styles.diffSymbol}>
                {op.type === "add" ? "+" : op.type === "del" ? "−" : " "}
              </span>
              <span style={styles.diffText}>{op.line || " "}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Revision panel
// ---------------------------------------------------------------------------

export function RevisionPanel({ repoId, slug, currentContent, onRestore, onClose }) {
  const [revisions, setRevisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [restoring, setRestoring] = useState(null);
  const [diffRev, setDiffRev] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.getWikiRevisions(repoId, slug).then((data) => {
      if (!cancelled) { setRevisions(data); setLoading(false); }
    }).catch((err) => {
      if (!cancelled) { setError(err.message); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [repoId, slug]);

  const handleRestore = async (rev) => {
    setRestoring(rev.id);
    try {
      const restored = await api.restoreWikiRevision(repoId, slug, rev.id);
      onRestore(restored);
      onClose();
    } catch (err) {
      setError(err.message || "No se pudo restaurar.");
      setRestoring(null);
    }
  };

  if (diffRev) {
    return (
      <DiffView
        currentContent={currentContent}
        revisionContent={diffRev.content_preview}
        onClose={() => setDiffRev(null)}
      />
    );
  }

  return (
    <div style={styles.revisionOverlay}>
      <div style={styles.revisionPanel}>
        <div style={styles.revisionHeader}>
          <span style={styles.revisionTitle}>Historial de revisiones</span>
          <button onClick={onClose} style={styles.closeBtn}><X size={14} /></button>
        </div>
        {loading && <div style={styles.revisionInfo}>Cargando…</div>}
        {error && <div style={styles.revisionError}>{error}</div>}
        {!loading && revisions.length === 0 && (
          <div style={styles.revisionInfo}>No hay revisiones guardadas todavía.</div>
        )}
        <div style={styles.revisionList}>
          {revisions.map((rev) => (
            <div key={rev.id} style={styles.revisionItem}>
              <div style={styles.revisionMeta}>
                <span style={styles.revisionDate}>
                  {new Date(rev.created_at).toLocaleString()}
                </span>
                {rev.is_ai_generated && (
                  <span style={styles.aiBadge}>IA</span>
                )}
              </div>
              <p style={styles.revisionPreview}>{rev.content_preview}…</p>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  style={styles.diffBtn}
                  onClick={() => setDiffRev(rev)}
                  title="Ver diferencias con la versión actual"
                >
                  diff
                </button>
                <button
                  style={styles.restoreBtn}
                  disabled={restoring === rev.id}
                  onClick={() => handleRestore(rev)}
                >
                  <RotateCcw size={12} />
                  {restoring === rev.id ? "Restaurando…" : "Restaurar"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Push to GitLab dialog
// ---------------------------------------------------------------------------

export function PushToGitLabDialog({ repoId, onClose }) {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState(null);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState("");

  const handlePush = async () => {
    if (!token.trim()) { setError("Introduce un PAT con scope api o write_wiki."); return; }
    setPushing(true);
    setError("");
    try {
      const result = await api.pushToGitLabWiki(repoId, token.trim());
      setStatus(result);
    } catch (err) {
      setError(err.message || "Error al publicar en GitLab Wiki.");
    } finally {
      setPushing(false);
    }
  };

  return (
    <div style={styles.revisionOverlay}>
      <div style={{ ...styles.revisionPanel, maxWidth: 420 }}>
        <div style={styles.revisionHeader}>
          <span style={styles.revisionTitle}>Publicar en GitLab Wiki</span>
          <button onClick={onClose} style={styles.closeBtn}><X size={14} /></button>
        </div>
        {status ? (
          <div style={{ padding: "16px 0" }}>
            <p style={{ color: "var(--text-primary)", marginBottom: 8 }}>
              ✓ {status.pages_pushed} página(s) publicadas correctamente.
            </p>
            {status.errors.length > 0 && (
              <div style={styles.revisionError}>
                Errores: {status.errors.join("; ")}
              </div>
            )}
            <button style={styles.saveButton} onClick={onClose}>Cerrar</button>
          </div>
        ) : (
          <>
            <p style={styles.revisionInfo}>
              Introduce un Personal Access Token de GitLab con scope <code>api</code> o <code>write_wiki</code>.
            </p>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="glpat-xxxxxxxxxxxxxxxxxxxx"
              style={styles.tokenInput}
              autoFocus
            />
            {error && <div style={styles.revisionError}>{error}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button style={styles.saveButton} onClick={handlePush} disabled={pushing}>
                <Upload size={13} />
                {pushing ? "Publicando…" : "Publicar"}
              </button>
              <button style={styles.cancelButton} onClick={onClose} disabled={pushing}>
                Cancelar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  revisionOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    zIndex: 200,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "flex-end",
  },
  revisionPanel: {
    width: 380,
    maxWidth: "90vw",
    height: "100vh",
    overflowY: "auto",
    background: "var(--bg-elevated)",
    borderLeft: "1px solid var(--border-subtle)",
    padding: "24px 20px",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  revisionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  revisionTitle: {
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
    padding: 4,
  },
  revisionList: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  revisionItem: {
    background: "var(--bg-elevated-2)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 6,
    padding: "10px 12px",
  },
  revisionMeta: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  revisionDate: {
    fontSize: 11,
    fontFamily: "var(--font-mono)",
    color: "var(--text-tertiary)",
  },
  aiBadge: {
    fontSize: 9,
    letterSpacing: "0.06em",
    fontFamily: "var(--font-mono)",
    background: "var(--accent-rust)",
    color: "var(--accent-on-rust)",
    borderRadius: 3,
    padding: "1px 5px",
  },
  revisionPreview: {
    fontSize: 11.5,
    color: "var(--text-secondary)",
    fontFamily: "var(--font-serif)",
    lineHeight: 1.5,
    marginBottom: 8,
    whiteSpace: "pre-wrap",
    overflow: "hidden",
    maxHeight: 60,
  },
  restoreBtn: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    fontFamily: "var(--font-mono)",
    padding: "3px 10px",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 4,
    cursor: "pointer",
    color: "var(--text-secondary)",
  },
  revisionInfo: {
    fontSize: 12,
    color: "var(--text-tertiary)",
    fontFamily: "var(--font-serif)",
    lineHeight: 1.6,
    marginBottom: 12,
  },
  revisionError: {
    fontSize: 12,
    color: "var(--accent-red)",
    fontFamily: "var(--font-mono)",
    background: "rgba(192,89,74,0.1)",
    padding: "8px 10px",
    borderRadius: 4,
    marginBottom: 8,
  },
  diffBtn: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    fontFamily: "var(--font-mono)",
    padding: "3px 10px",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 4,
    cursor: "pointer",
    color: "var(--accent-rust)",
  },
  diffOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    zIndex: 250,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "flex-end",
  },
  diffPanel: {
    width: 520,
    maxWidth: "90vw",
    height: "100vh",
    overflowY: "auto",
    background: "var(--bg-elevated)",
    borderLeft: "1px solid var(--border-subtle)",
    padding: "24px 0",
    display: "flex",
    flexDirection: "column",
    gap: 0,
  },
  diffBody: {
    fontFamily: "var(--font-mono)",
    fontSize: 11.5,
    overflowX: "auto",
    flex: 1,
  },
  diffLine: {
    display: "flex",
    alignItems: "flex-start",
    padding: "1px 12px",
    lineHeight: 1.6,
    whiteSpace: "pre",
  },
  diffAdd: {
    background: "rgba(80,160,80,0.15)",
    borderLeft: "2px solid rgba(80,160,80,0.5)",
    color: "var(--accent-sage)",
  },
  diffDel: {
    background: "rgba(192,89,74,0.12)",
    borderLeft: "2px solid rgba(192,89,74,0.4)",
    color: "var(--accent-red)",
  },
  diffSymbol: {
    width: 16,
    flexShrink: 0,
    userSelect: "none",
    opacity: 0.7,
  },
  diffText: {
    flex: 1,
    overflowX: "visible",
  },
  tokenInput: {
    width: "100%",
    padding: "8px 12px",
    fontSize: 13,
    fontFamily: "var(--font-mono)",
    color: "var(--text-primary)",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 6,
    outline: "none",
    boxSizing: "border-box",
  },
  saveButton: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "5px 12px",
    fontSize: 12,
    fontFamily: "var(--font-mono)",
    color: "var(--accent-on-rust)",
    background: "var(--accent-rust)",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
  },
  cancelButton: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "5px 12px",
    fontSize: 12,
    fontFamily: "var(--font-mono)",
    color: "var(--text-secondary)",
    background: "var(--bg-elevated-2)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 6,
    cursor: "pointer",
  },
};
