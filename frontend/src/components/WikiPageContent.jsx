import { useEffect, useId, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Pencil, Check, X } from "lucide-react";
import mermaid from "../utils/mermaid";

function MermaidDiagram({ code }) {
  const containerRef = useRef(null);
  const [error, setError] = useState(null);
  const rawId = useId();
  const diagramId = `mermaid-${rawId.replace(/:/g, "")}`;

  useEffect(() => {
    let cancelled = false;
    mermaid
      .render(diagramId, code)
      .then(({ svg }) => {
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <div style={styles.mermaidError}>
        No se pudo renderizar el diagrama. <code>{error}</code>
      </div>
    );
  }

  return <div ref={containerRef} style={styles.mermaidContainer} />;
}

export function WikiPageContent({ page, onUpdatePage }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Exit edit mode whenever the user navigates to a different page.
  useEffect(() => {
    setIsEditing(false);
    setEditedContent("");
    setSaveError("");
  }, [page?.slug]);

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

  return (
    <article style={styles.article}>
      <div style={styles.pageHeader}>
        <h1 style={styles.h1}>{page.title}</h1>
        {onUpdatePage && !isEditing && (
          <button onClick={handleEditStart} style={styles.editButton} title="Editar página">
            <Pencil size={14} />
            Editar
          </button>
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

            if (lang === "mermaid") {
              return <MermaidDiagram code={String(children).trim()} />;
            }

            if (lang) {
              return (
                <SyntaxHighlighter
                  language={lang}
                  style={vscDarkPlus}
                  customStyle={{
                    borderRadius: 8,
                    fontSize: 12.5,
                    border: "1px solid var(--border-subtle)",
                    margin: "16px 0",
                  }}
                >
                  {String(children).replace(/\n$/, "")}
                </SyntaxHighlighter>
              );
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
            {page.source_files.map((f) => (
              <span key={f} style={styles.sourceTag}>
                {f}
              </span>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

const styles = {
  article: {
    maxWidth: 720,
    margin: "0 auto",
    padding: "56px 32px 120px",
  },
  pageHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 28,
  },
  editButton: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    flexShrink: 0,
    marginTop: 6,
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
    flexShrink: 0,
    marginTop: 6,
  },
  saveButton: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "5px 12px",
    fontSize: 12,
    fontFamily: "var(--font-mono)",
    color: "#fff",
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
  mermaidContainer: {
    display: "flex",
    justifyContent: "center",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 8,
    padding: "24px 12px",
    margin: "20px 0",
    overflowX: "auto",
  },
  mermaidError: {
    fontSize: 12,
    color: "var(--accent-red)",
    background: "rgba(192,89,74,0.1)",
    padding: 12,
    borderRadius: 6,
    margin: "16px 0",
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
