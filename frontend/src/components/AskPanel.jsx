import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { api } from "../api/client";
import { languageFromPath } from "../utils/language";

/** Un fragmento de código fuente usado como evidencia de una respuesta, colapsado por defecto. */
function SourceExtract({ source }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={styles.sourceCard}>
      <button onClick={() => setExpanded((v) => !v)} style={styles.sourceHeader}>
        <span style={styles.sourceChevron}>{expanded ? "▾" : "▸"}</span>
        <span style={styles.sourcePath}>{source.file_path}</span>
        <span style={styles.sourceLines}>
          L{source.start_line}-{source.end_line}
        </span>
      </button>
      {expanded && (
        <SyntaxHighlighter
          language={languageFromPath(source.file_path)}
          style={vscDarkPlus}
          showLineNumbers
          startingLineNumber={source.start_line}
          customStyle={{
            margin: 0,
            fontSize: 11.5,
            borderTop: "1px solid var(--border-subtle)",
            borderRadius: 0,
            maxHeight: 260,
          }}
        >
          {source.content}
        </SyntaxHighlighter>
      )}
    </div>
  );
}

export function AskPanel({ repositoryId, ragAvailable }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const handleAsk = async (e) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || loading) return;

    setQuestion("");
    setLoading(true);
    setMessages((prev) => [
      ...prev,
      { role: "user", text: q },
      { role: "assistant", text: "", sources: [], streaming: true },
    ]);

    try {
      for await (const event of api.streamAskQuestion(repositoryId, q)) {
        if (event.token !== undefined) {
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last?.streaming) {
              copy[copy.length - 1] = { ...last, text: last.text + event.token };
            }
            return copy;
          });
        } else if (event.sources !== undefined) {
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last?.streaming) {
              copy[copy.length - 1] = { ...last, sources: event.sources };
            }
            return copy;
          });
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const copy = [...prev];
        if (copy[copy.length - 1]?.streaming) {
          copy[copy.length - 1] = { role: "error", text: err.message };
        } else {
          copy.push({ role: "error", text: err.message });
        }
        return copy;
      });
    } finally {
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.streaming) {
          copy[copy.length - 1] = { ...last, streaming: false };
        }
        return copy;
      });
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={styles.fab}>
        ¿preguntas sobre este repo?
      </button>
    );
  }

  return (
    <div style={styles.panel}>
      <div style={styles.panelHeader}>
        <span style={styles.panelTitle}>preguntar al repo</span>
        <button onClick={() => setOpen(false)} style={styles.closeBtn}>
          ✕
        </button>
      </div>

      {!ragAvailable && (
        <div style={styles.degradedBanner}>
          búsqueda semántica sobre código no disponible para este repo — las respuestas se
          basan solo en el wiki generado, sin extractos de código
        </div>
      )}

      <div ref={scrollRef} style={styles.messages}>
        {messages.length === 0 && (
          <div style={styles.emptyHint}>
            {ragAvailable
              ? "Pregunta algo sobre el código real del proyecto. La respuesta incluye los fragmentos de código exactos usados para generarla."
              : "Pregunta algo sobre la arquitectura, un módulo o cómo ejecutar el proyecto, basado en el wiki ya generado."}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={styles.messageGroup}>
            <div
              style={{
                ...styles.message,
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                background: m.role === "user" ? "var(--accent-rust-dim)" : "var(--bg-elevated-2)",
                color: m.role === "error" ? "var(--accent-red)" : "var(--text-primary)",
              }}
            >
              {m.role === "assistant" ? <ReactMarkdown>{m.text}</ReactMarkdown> : m.text}
            </div>

            {m.role === "assistant" && m.sources?.length > 0 && (
              <div style={styles.sourcesBlock}>
                <div style={styles.sourcesLabel}>
                  código usado para esta respuesta ({m.sources.length})
                </div>
                {m.sources.map((s, si) => (
                  <SourceExtract key={`${s.file_path}-${si}`} source={s} />
                ))}
              </div>
            )}
          </div>
        ))}
        {loading && !messages[messages.length - 1]?.streaming && (
          <div style={{ ...styles.message, ...styles.thinking }}>pensando…</div>
        )}
      </div>

      <form onSubmit={handleAsk} style={styles.inputRow}>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="¿cómo se autentican los usuarios?"
          style={styles.input}
        />
        <button type="submit" style={styles.sendBtn} disabled={loading}>
          enviar
        </button>
      </form>
    </div>
  );
}

const styles = {
  fab: {
    position: "fixed",
    bottom: 24,
    right: 24,
    background: "var(--accent-rust)",
    color: "#1A1410",
    border: "none",
    borderRadius: 24,
    padding: "12px 20px",
    fontSize: 12.5,
    fontWeight: 600,
    boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
    cursor: "pointer",
  },
  panel: {
    position: "fixed",
    bottom: 24,
    right: 24,
    width: 460,
    height: 560,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 12,
    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 14px",
    borderBottom: "1px solid var(--border-subtle)",
  },
  panelTitle: {
    fontSize: 11.5,
    letterSpacing: "0.04em",
    color: "var(--text-secondary)",
  },
  closeBtn: {
    background: "none",
    border: "none",
    color: "var(--text-tertiary)",
    fontSize: 13,
    cursor: "pointer",
  },
  degradedBanner: {
    fontSize: 11,
    lineHeight: 1.5,
    color: "#D9B98C",
    background: "rgba(201,124,74,0.1)",
    borderBottom: "1px solid var(--border-subtle)",
    padding: "8px 14px",
  },
  messages: {
    flex: 1,
    overflowY: "auto",
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  messageGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  emptyHint: {
    fontFamily: "var(--font-serif)",
    fontSize: 13,
    color: "var(--text-tertiary)",
    lineHeight: 1.6,
  },
  message: {
    maxWidth: "92%",
    padding: "8px 11px",
    borderRadius: 8,
    fontSize: 13,
    lineHeight: 1.5,
  },
  sourcesBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
    alignSelf: "flex-start",
    width: "92%",
  },
  sourcesLabel: {
    fontSize: 10,
    letterSpacing: "0.04em",
    color: "var(--text-tertiary)",
    marginTop: 2,
  },
  sourceCard: {
    border: "1px solid var(--border-subtle)",
    borderRadius: 6,
    overflow: "hidden",
    background: "#1E1E1E", // fondo del tema vscDarkPlus, para que el header combine con el código
  },
  sourceHeader: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    width: "100%",
    background: "var(--bg-elevated-2)",
    border: "none",
    padding: "6px 10px",
    fontSize: 11,
    fontFamily: "var(--font-mono)",
    textAlign: "left",
    cursor: "pointer",
  },
  sourceChevron: {
    color: "var(--text-tertiary)",
    fontSize: 10,
    flexShrink: 0,
  },
  sourcePath: {
    color: "var(--text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
  },
  sourceLines: {
    color: "var(--text-tertiary)",
    flexShrink: 0,
  },
  thinking: {
    background: "var(--bg-elevated-2)",
    color: "var(--text-tertiary)",
    fontSize: 12,
  },
  inputRow: {
    display: "flex",
    gap: 8,
    padding: 12,
    borderTop: "1px solid var(--border-subtle)",
  },
  input: {
    flex: 1,
    background: "var(--bg-elevated-2)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 6,
    padding: "8px 10px",
    fontSize: 12.5,
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono)",
    outline: "none",
  },
  sendBtn: {
    background: "var(--accent-rust)",
    border: "none",
    borderRadius: 6,
    padding: "0 14px",
    fontSize: 12,
    fontWeight: 600,
    color: "#1A1410",
    cursor: "pointer",
  },
};
