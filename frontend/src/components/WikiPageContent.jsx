import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, History, Pencil, RotateCcw, Upload, X } from "lucide-react";
import { MermaidDiagram } from "./MermaidDiagram";
import { RevisionPanel, PushToGitLabDialog } from "./RevisionPanel";
import { gitLabSourceUrl } from "../utils/gitlab";
import { HighlightedCode } from "./HighlightedCode";

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
};
