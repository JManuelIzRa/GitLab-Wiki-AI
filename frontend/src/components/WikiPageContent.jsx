import { useCallback, useEffect, useId, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Download, History, Pencil, RotateCcw, Upload, X } from "lucide-react";
import mermaid, { MERMAID_DARK_VARS, MERMAID_LIGHT_VARS } from "../utils/mermaid";
import { api } from "../api/client";
import { gitLabSourceUrl } from "../utils/gitlab";
import { HighlightedCode } from "./HighlightedCode";

// ---------------------------------------------------------------------------
// Simple line-level diff (no external dep)
// ---------------------------------------------------------------------------

function computeLineDiff(aText, bText) {
  const aLines = aText.split("\n");
  const bLines = bText.split("\n");
  // Build a simple LCS-based diff
  const m = aLines.length;
  const n = bLines.length;
  // dp[i][j] = LCS length of aLines[0..i) and bLines[0..j)
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = aLines[i - 1] === bLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  // Backtrack
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
// Toast
// ---------------------------------------------------------------------------

function Toast({ message, onHide }) {
  useEffect(() => {
    const t = setTimeout(onHide, 2400);
    return () => clearTimeout(t);
  }, [onHide]);

  return (
    <div style={styles.toast}>
      <Check size={13} />
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mermaid
// ---------------------------------------------------------------------------

function MermaidDiagram({ code }) {
  const containerRef = useRef(null);
  const [error, setError] = useState(null);
  const [isRendering, setIsRendering] = useState(true);
  const [zoomed, setZoomed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [svgSnapshot, setSvgSnapshot] = useState("");
  const renderSeq = useRef(0);
  const rawId = useId();
  const baseId = `mermaid-${rawId.replace(/:/g, "")}`;

  // Track app theme so diagrams re-render when user switches dark/light
  const [mermaidTheme, setMermaidTheme] = useState(
    () => document.documentElement.getAttribute("data-theme") === "light" ? "default" : "dark"
  );

  // During-render pattern: reset error/loading state when render deps change,
  // avoiding synchronous setState inside useEffect.
  const [prevRenderDeps, setPrevRenderDeps] = useState({ code, mermaidTheme, retryCount });
  if (prevRenderDeps.code !== code || prevRenderDeps.mermaidTheme !== mermaidTheme || prevRenderDeps.retryCount !== retryCount) {
    setPrevRenderDeps({ code, mermaidTheme, retryCount });
    setError(null);
    setIsRendering(true);
  }

  useEffect(() => {
    const mo = new MutationObserver(() => {
      setMermaidTheme(
        document.documentElement.getAttribute("data-theme") === "light" ? "default" : "dark"
      );
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  // Close zoom on Escape key
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e) => { if (e.key === "Escape") setZoomed(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [zoomed]);

  useEffect(() => {
    let cancelled = false;

    // Unique ID per render call — prevents "element already exists" when code changes
    // while a previous mermaid.render() is still in flight.
    const renderId = `${baseId}-${++renderSeq.current}`;

    mermaid.initialize({
      startOnLoad: false,
      theme: mermaidTheme,
      themeVariables: mermaidTheme === "default" ? MERMAID_LIGHT_VARS : MERMAID_DARK_VARS,
    });

    // 8-second safety timeout for complex or malformed diagrams that never reject
    let timedOut = false;
    const tid = setTimeout(() => {
      timedOut = true;
      document.getElementById(`d${renderId}`)?.remove();
      if (!cancelled) {
        setError("El diagrama tardó más de 8 s en renderizarse.");
        setIsRendering(false);
      }
    }, 8_000);

    mermaid
      .render(renderId, code)
      .then(({ svg }) => {
        clearTimeout(tid);
        if (!cancelled && !timedOut && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setSvgSnapshot(svg);
          setIsRendering(false);
        }
      })
      .catch((err) => {
        clearTimeout(tid);
        // Clean up the hidden element Mermaid leaves in <body> on failure
        document.getElementById(`d${renderId}`)?.remove();
        if (!cancelled) {
          setError(err?.message || "Error de sintaxis en el diagrama.");
          setIsRendering(false);
        }
      });

    return () => {
      cancelled = true;
      clearTimeout(tid);
      document.getElementById(`d${renderId}`)?.remove();
    };
  }, [baseId, code, mermaidTheme, retryCount]);

  const handleCopyCode = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }, [code]);

  const handleDownloadSVG = useCallback(() => {
    const svg = containerRef.current?.innerHTML;
    if (!svg) return;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "diagram.svg";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  if (error) {
    return (
      <div style={styles.mermaidError}>
        <div style={styles.mermaidErrorHeader}>
          <span>No se pudo renderizar el diagrama</span>
          <button
            style={styles.mermaidRetryBtn}
            onClick={() => { setError(null); setRetryCount((c) => c + 1); }}
          >
            reintentar
          </button>
        </div>
        <code style={{ display: "block", marginTop: 6, wordBreak: "break-all", fontSize: 11 }}>{error}</code>
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontSize: 11, color: "var(--text-tertiary)" }}>ver código fuente</summary>
          <pre style={styles.mermaidRawPre}>{code}</pre>
        </details>
      </div>
    );
  }

  return (
    <>
      <div style={styles.mermaidWrapper}>
        {/* Loading shimmer shown while mermaid renders */}
        {isRendering && <div style={styles.mermaidLoadingOverlay}><div style={styles.mermaidLoadingBar} /></div>}

        <div
          ref={containerRef}
          style={{ ...styles.mermaidContainer, cursor: isRendering ? "default" : "zoom-in" }}
          title={isRendering ? undefined : "Clic para ampliar"}
          onClick={() => { if (!isRendering) setZoomed(true); }}
        />

        {!isRendering && (
          <button
            style={{ ...styles.diagramActionBtn, color: copied ? "var(--accent-sage)" : "var(--text-tertiary)" }}
            onClick={(e) => { e.stopPropagation(); handleCopyCode(); }}
            title="Copiar código"
          >
            {copied ? <Check size={11} /> : "⎘"}
          </button>
        )}
      </div>

      {zoomed && (
        <div style={styles.zoomOverlay} onClick={() => setZoomed(false)}>
          <div style={styles.zoomPanel} onClick={(e) => e.stopPropagation()}>
            <button style={styles.zoomClose} onClick={() => setZoomed(false)} title="Cerrar (Esc)">
              <X size={14} />
            </button>
            <button style={styles.zoomDownloadBtn} onClick={handleDownloadSVG} title="Descargar SVG">
              <Download size={13} />
            </button>
            <div
              style={styles.zoomContent}
              dangerouslySetInnerHTML={{ __html: svgSnapshot }}
            />
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Code block with copy button
// ---------------------------------------------------------------------------

function CodeBlock({ lang, children }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(children).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }, [children]);

  return (
    <div style={styles.codeWrapper}>
      <button
        style={{ ...styles.copyBtn, color: copied ? "var(--accent-sage)" : "var(--text-tertiary)" }}
        onClick={handleCopy}
        title="Copiar código"
      >
        {copied ? <Check size={11} /> : "⎘"}
      </button>
      <HighlightedCode
        language={lang}
        customStyle={{
          borderRadius: 8,
          fontSize: 12.5,
          border: "1px solid var(--border-subtle)",
          margin: "16px 0",
        }}
      >
        {children.replace(/\n$/, "")}
      </HighlightedCode>
    </div>
  );
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

function RevisionPanel({ repoId, slug, currentContent, onRestore, onClose }) {
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

function PushToGitLabDialog({ repoId, onClose }) {
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
// Main component
// ---------------------------------------------------------------------------

export function WikiPageContent({ page, repositoryId, repository, onUpdatePage, onRegenerate }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [showRevisions, setShowRevisions] = useState(false);
  const [showPushDialog, setShowPushDialog] = useState(false);
  const [toast, setToast] = useState(null);

  const hideToast = useCallback(() => setToast(null), []);

  // Reset editing state when navigating to a different page (during-render pattern,
  // avoids calling setState inside useEffect which causes an extra render cycle).
  const [prevSlug, setPrevSlug] = useState(page?.slug);
  if (prevSlug !== page?.slug) {
    setPrevSlug(page?.slug);
    setIsEditing(false);
    setEditedContent("");
    setSaveError("");
    setShowRevisions(false);
    setToast(null);
  }

  if (!page) return null;

  const handleEditStart = () => {
    setEditedContent(page.content_markdown);
    setSaveError("");
    setIsEditing(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError("");
    try {
      await onUpdatePage(page.slug, editedContent);
      setIsEditing(false);
      setToast("Guardado correctamente");
    } catch (err) {
      setSaveError(err.message || "No se pudo guardar la página.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditedContent("");
    setSaveError("");
  };

  const handleRestored = (restoredPage) => {
    onUpdatePage?.(restoredPage.slug, restoredPage.content_markdown, restoredPage);
    setToast("Revisión restaurada");
  };

  return (
    <article style={styles.article} className="wiki-article">
      {toast && <Toast message={toast} onHide={hideToast} />}

      <div style={styles.pageHeader} className="wiki-page-header">
        <h1 style={styles.h1}>{page.title}</h1>
        <div style={styles.pageActions}>
          {!isEditing && onUpdatePage && (
            <>
              <button onClick={() => setShowPushDialog(true)} style={styles.actionButton} title="Publicar en GitLab Wiki">
                <Upload size={14} />
                GitLab Wiki
              </button>
              <button onClick={() => setShowRevisions(true)} style={styles.actionButton} title="Ver historial de revisiones">
                <History size={14} />
                Historial
              </button>
              <button onClick={handleEditStart} style={styles.editButton} title="Editar página (E)">
                <Pencil size={14} />
                Editar
              </button>
              {page.is_ai_generated && onRegenerate && (
                <button onClick={() => onRegenerate(page.slug)} style={styles.actionButton} title="Regenerar solo esta página">
                  <RotateCcw size={14} /> Regenerar
                </button>
              )}
            </>
          )}
          {isEditing && (
            <div style={styles.editActions}>
              {saveError && <span style={styles.saveError}>{saveError}</span>}
              <button onClick={handleSave} disabled={isSaving} style={styles.saveButton}>
                <Check size={14} />
                {isSaving ? "Guardando…" : "Guardar"}
              </button>
              <button onClick={handleCancel} disabled={isSaving} style={styles.cancelButton}>
                <X size={14} />
                Cancelar
              </button>
            </div>
          )}
        </div>
      </div>

      {isEditing ? (
        <textarea
          value={editedContent}
          onChange={(e) => setEditedContent(e.target.value)}
          style={styles.editor}
          spellCheck={false}
          autoFocus
        />
      ) : (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || "");
              const lang = match?.[1];
              const codeStr = String(children).replace(/\n$/, "");

              if (lang === "mermaid") {
                return <MermaidDiagram code={codeStr} />;
              }

              if (lang) {
                return <CodeBlock lang={lang}>{codeStr}</CodeBlock>;
              }

              return (
                <code style={styles.inlineCode} {...props}>
                  {children}
                </code>
              );
            },
            h2: (props) => <h2 style={styles.h2} {...props} />,
            h3: (props) => <h3 style={styles.h3} {...props} />,
            p: (props) => <p style={styles.p} {...props} />,
            ul: (props) => <ul style={styles.list} {...props} />,
            ol: (props) => <ol style={styles.list} {...props} />,
            li: (props) => <li style={styles.li} {...props} />,
            a: (props) => <a style={styles.link} {...props} target="_blank" rel="noreferrer" />,
            blockquote: (props) => <blockquote style={styles.blockquote} {...props} />,
            table: (props) => <table style={styles.table} {...props} />,
            th: (props) => <th style={styles.th} {...props} />,
            td: (props) => <td style={styles.td} {...props} />,
          }}
        >
          {page.content_markdown}
        </ReactMarkdown>
      )}

      {page.source_files?.length > 0 && (
        <div style={styles.sourcesBox}>
          <div style={styles.sourcesLabel}>archivos fuente</div>
          <div style={styles.sourcesList}>
            {page.source_files.map((f) => {
              const href = gitLabSourceUrl(repository, f);
              return href ? (
                <a key={f} href={href} target="_blank" rel="noreferrer" style={styles.sourceTag}>{f} ↗</a>
              ) : <span key={f} style={styles.sourceTag}>{f}</span>;
            })}
          </div>
        </div>
      )}

      {showRevisions && repositoryId && (
        <RevisionPanel
          repoId={repositoryId}
          slug={page.slug}
          currentContent={page.content_markdown}
          onRestore={handleRestored}
          onClose={() => setShowRevisions(false)}
        />
      )}

      {showPushDialog && repositoryId && (
        <PushToGitLabDialog repoId={repositoryId} onClose={() => setShowPushDialog(false)} />
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  article: {
    maxWidth: 720,
    margin: "0 auto",
    padding: "56px 32px 120px",
    position: "relative",
  },
  toast: {
    position: "fixed",
    bottom: 28,
    right: 28,
    background: "var(--accent-sage-dim)",
    color: "var(--accent-on-sage)",
    borderRadius: 8,
    padding: "10px 18px",
    fontSize: 13,
    fontFamily: "var(--font-mono)",
    display: "flex",
    alignItems: "center",
    gap: 8,
    zIndex: 300,
    boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
    animation: "fadeIn 0.15s ease",
  },
  pageHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 28,
  },
  pageActions: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
    marginTop: 6,
  },
  actionButton: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "5px 10px",
    fontSize: 12,
    fontFamily: "var(--font-mono)",
    color: "var(--text-tertiary)",
    background: "var(--bg-elevated-2)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 6,
    cursor: "pointer",
  },
  editButton: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "5px 12px",
    fontSize: 12,
    fontFamily: "var(--font-mono)",
    color: "var(--text-tertiary)",
    background: "var(--bg-elevated-2)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 6,
    cursor: "pointer",
  },
  editActions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
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
  saveError: {
    fontSize: 11,
    color: "var(--accent-red)",
    fontFamily: "var(--font-mono)",
  },
  editor: {
    width: "100%",
    minHeight: 480,
    padding: "16px",
    fontSize: 13.5,
    fontFamily: "var(--font-mono)",
    color: "var(--text-primary)",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 8,
    resize: "vertical",
    outline: "none",
    lineHeight: 1.6,
    boxSizing: "border-box",
    marginBottom: 8,
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
  h1: {
    fontFamily: "var(--font-serif)",
    fontSize: 36,
    fontWeight: 700,
    color: "var(--text-primary)",
    margin: 0,
    letterSpacing: "-0.01em",
    lineHeight: 1.2,
  },
  h2: {
    fontFamily: "var(--font-serif)",
    fontSize: 23,
    fontWeight: 600,
    color: "var(--text-primary)",
    margin: "40px 0 14px",
    borderTop: "1px solid var(--border-subtle)",
    paddingTop: 28,
  },
  h3: {
    fontFamily: "var(--font-serif)",
    fontSize: 18,
    fontWeight: 600,
    color: "var(--text-primary)",
    margin: "28px 0 10px",
  },
  p: {
    fontFamily: "var(--font-serif)",
    fontSize: 16.5,
    lineHeight: 1.75,
    color: "var(--text-secondary)",
    margin: "0 0 16px",
  },
  list: {
    fontFamily: "var(--font-serif)",
    fontSize: 16.5,
    lineHeight: 1.75,
    color: "var(--text-secondary)",
    margin: "0 0 16px",
    paddingLeft: 24,
  },
  li: {
    marginBottom: 6,
  },
  link: {
    color: "var(--accent-rust)",
    textDecoration: "underline",
    textDecorationColor: "var(--accent-rust-dim)",
  },
  blockquote: {
    borderLeft: "3px solid var(--accent-rust)",
    margin: "20px 0",
    padding: "4px 0 4px 18px",
    color: "var(--text-tertiary)",
    fontStyle: "italic",
    fontFamily: "var(--font-serif)",
  },
  inlineCode: {
    background: "var(--bg-elevated-2)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 4,
    padding: "2px 6px",
    fontSize: "0.85em",
    fontFamily: "var(--font-mono)",
    color: "var(--accent-rust)",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    margin: "20px 0",
    fontSize: 13.5,
  },
  th: {
    textAlign: "left",
    borderBottom: "1px solid var(--border-strong)",
    padding: "8px 10px",
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono)",
  },
  td: {
    borderBottom: "1px solid var(--border-subtle)",
    padding: "8px 10px",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-serif)",
  },
  codeWrapper: {
    position: "relative",
  },
  copyBtn: {
    position: "absolute",
    top: 26,
    right: 8,
    zIndex: 2,
    background: "rgba(32,29,23,0.7)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 4,
    padding: "3px 7px",
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "var(--font-mono)",
    lineHeight: 1,
  },
  mermaidWrapper: {
    position: "relative",
    margin: "20px 0",
  },
  mermaidLoadingOverlay: {
    position: "absolute",
    inset: 0,
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-subtle)",
    zIndex: 1,
  },
  mermaidLoadingBar: {
    position: "absolute",
    inset: 0,
    backgroundImage: "linear-gradient(90deg, transparent 0%, var(--bg-hover) 50%, transparent 100%)",
    backgroundSize: "200% 100%",
    animation: "shimmer 1.8s ease-in-out infinite",
  },
  mermaidContainer: {
    display: "flex",
    justifyContent: "center",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 8,
    padding: "24px 12px",
    minHeight: 80,
    overflowX: "auto",
  },
  diagramActionBtn: {
    position: "absolute",
    top: 8,
    right: 8,
    zIndex: 2,
    background: "rgba(32,29,23,0.7)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 4,
    padding: "3px 7px",
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "var(--font-mono)",
    lineHeight: 1,
  },
  mermaidError: {
    fontSize: 12,
    color: "var(--accent-red)",
    background: "rgba(192,89,74,0.1)",
    border: "1px solid rgba(192,89,74,0.25)",
    padding: 12,
    borderRadius: 6,
    margin: "16px 0",
  },
  mermaidErrorHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  mermaidRetryBtn: {
    fontSize: 11,
    fontFamily: "var(--font-mono)",
    background: "var(--bg-elevated-2)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 4,
    padding: "2px 8px",
    cursor: "pointer",
    color: "var(--text-secondary)",
  },
  mermaidRawPre: {
    fontSize: 11,
    fontFamily: "var(--font-mono)",
    color: "var(--text-tertiary)",
    background: "var(--bg-elevated-2)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 4,
    padding: "8px 10px",
    margin: "6px 0 0",
    overflow: "auto",
    whiteSpace: "pre",
  },
  zoomOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.75)",
    zIndex: 400,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  zoomPanel: {
    position: "relative",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 12,
    padding: "40px 32px 32px",
    maxWidth: "90vw",
    maxHeight: "90vh",
    overflow: "auto",
    minWidth: 360,
  },
  zoomContent: {
    display: "flex",
    justifyContent: "center",
  },
  zoomClose: {
    position: "absolute",
    top: 12,
    right: 12,
    background: "var(--bg-elevated-2)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 4,
    padding: "4px 8px",
    cursor: "pointer",
    color: "var(--text-secondary)",
  },
  zoomDownloadBtn: {
    position: "absolute",
    top: 12,
    right: 48,
    background: "var(--bg-elevated-2)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 4,
    padding: "4px 8px",
    cursor: "pointer",
    color: "var(--text-secondary)",
    display: "flex",
    alignItems: "center",
  },
  sourcesBox: {
    marginTop: 48,
    paddingTop: 20,
    borderTop: "1px solid var(--border-subtle)",
  },
  sourcesLabel: {
    fontSize: 10.5,
    letterSpacing: "0.06em",
    color: "var(--text-tertiary)",
    marginBottom: 10,
  },
  sourcesList: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  },
  sourceTag: {
    fontSize: 11,
    fontFamily: "var(--font-mono)",
    background: "var(--bg-elevated-2)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 4,
    padding: "3px 8px",
    color: "var(--text-tertiary)",
  },
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
};
