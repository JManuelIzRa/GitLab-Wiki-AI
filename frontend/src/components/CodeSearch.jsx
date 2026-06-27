import { useState } from "react";
import { api } from "../api/client";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { languageFromPath } from "../utils/language";
import { gitLabSourceUrl } from "../utils/gitlab";
import { HighlightedCode } from "./HighlightedCode";

function matchingLineNumbers(content, query, startLine) {
  if (!query) return new Set();
  const lower = query.toLowerCase();
  const lines = content.split("\n");
  const matched = new Set();
  lines.forEach((line, i) => {
    if (line.toLowerCase().includes(lower)) matched.add(startLine + i);
  });
  return matched;
}

function ResultCard({ result, query, repository }) {
  const [expanded, setExpanded] = useState(true);
  const matchedLines = matchingLineNumbers(result.content, query, result.start_line);

  return (
    <div style={styles.resultCard}>
      <button onClick={() => setExpanded((v) => !v)} style={styles.resultHeader}>
        <span style={styles.resultChevron}>{expanded ? "▾" : "▸"}</span>
        <span style={styles.resultPath}>{result.file_path}</span>
        <span style={styles.resultLines}>
          L{result.start_line}-{result.end_line}
        </span>
        {matchedLines.size > 0 && (
          <span style={styles.matchCount}>{matchedLines.size} coincidencia{matchedLines.size !== 1 ? "s" : ""}</span>
        )}
        <span style={styles.resultScore}>{(result.score * 100).toFixed(0)}%</span>
      </button>
      {expanded && (
        <HighlightedCode
          language={languageFromPath(result.file_path)}
          showLineNumbers
          startingLineNumber={result.start_line}
          wrapLines
          lineProps={(lineNumber) =>
            matchedLines.has(lineNumber)
              ? { style: { display: "block", backgroundColor: "rgba(255,210,0,0.12)", borderLeft: "2px solid rgba(255,210,0,0.5)" } }
              : { style: { display: "block" } }
          }
          customStyle={{ margin: 0, fontSize: 12, borderTop: "1px solid var(--border-subtle)", borderRadius: 0 }}
        >
          {result.content}
        </HighlightedCode>
      )}
      {gitLabSourceUrl(repository, result.file_path, result.start_line, result.end_line) && (
        <a href={gitLabSourceUrl(repository, result.file_path, result.start_line, result.end_line)} target="_blank" rel="noreferrer" style={styles.sourceLink}>
          abrir en GitLab ↗
        </a>
      )}
    </div>
  );
}

/**
 * Buscador global de código: como un "grep semántico" sobre el repo indexado.
 * A diferencia de AskPanel, no llama al LLM — solo recupera y muestra los chunks
 * de código más relevantes, así que la respuesta es instantánea y no genera texto nuevo.
 */
export function CodeSearch({ repositoryId, repository, ragAvailable, onClose }) {
  const trapRef = useFocusTrap();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSearch = async (e) => {
    e.preventDefault();
    const q = query.trim();
    if (!q || loading) return;

    setLoading(true);
    setError("");
    try {
      const res = await api.searchCode(repositoryId, q);
      setResults(res.results);
    } catch (err) {
      setError(err.message || "No se pudo completar la búsqueda.");
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div ref={trapRef} style={styles.modal} role="dialog" aria-modal="true" aria-label="Buscar en el código" onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>buscar en el código</span>
          <button onClick={onClose} style={styles.closeBtn}>
            ✕
          </button>
        </div>

        {!ragAvailable ? (
          <div style={styles.unavailable}>
            La búsqueda semántica no está disponible para este repositorio (el código no
            se pudo indexar en Qdrant). Puedes seguir usando el chat sobre el wiki.
          </div>
        ) : (
          <>
            <form onSubmit={handleSearch} style={styles.searchRow}>
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ej. dónde se valida el token de autenticación"
                style={styles.input}
              />
              <button type="submit" style={styles.searchBtn} disabled={loading}>
                {loading ? "buscando…" : "buscar"}
              </button>
            </form>

            {error && <div style={styles.errorBox}>{error}</div>}

            <div style={styles.resultsArea}>
              {results === null && !error && (
                <p style={styles.hint}>
                  Busca por significado, no solo por texto exacto — ej. "manejo de errores de
                  red" encontrará código relevante aunque no contenga esas palabras literalmente.
                </p>
              )}
              {results?.length === 0 && <p style={styles.hint}>Sin resultados relevantes.</p>}
              {results?.map((r, i) => (
                <ResultCard key={`${r.file_path}-${i}`} result={r} query={query} repository={repository} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.55)",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    paddingTop: "8vh",
    zIndex: 50,
  },
  modal: {
    width: "100%",
    maxWidth: 640,
    maxHeight: "78vh",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 12,
    boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 16px",
    borderBottom: "1px solid var(--border-subtle)",
  },
  title: {
    fontSize: 12,
    letterSpacing: "0.05em",
    color: "var(--text-secondary)",
  },
  closeBtn: {
    background: "none",
    border: "none",
    color: "var(--text-tertiary)",
    fontSize: 14,
    cursor: "pointer",
  },
  unavailable: {
    padding: "20px 16px",
    fontFamily: "var(--font-serif)",
    fontSize: 14,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
  },
  searchRow: {
    display: "flex",
    gap: 8,
    padding: 14,
    borderBottom: "1px solid var(--border-subtle)",
  },
  input: {
    flex: 1,
    background: "var(--bg-elevated-2)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 6,
    padding: "10px 12px",
    fontSize: 13,
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono)",
    outline: "none",
  },
  searchBtn: {
    background: "var(--accent-rust)",
    border: "none",
    borderRadius: 6,
    padding: "0 16px",
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--accent-on-rust)",
    whiteSpace: "nowrap",
    cursor: "pointer",
  },
  errorBox: {
    margin: "0 14px",
    marginTop: 12,
    background: "rgba(192,89,74,0.12)",
    border: "1px solid var(--accent-red)",
    borderRadius: 6,
    padding: "8px 12px",
    fontSize: 12,
    color: "var(--text-error)",
  },
  resultsArea: {
    flex: 1,
    overflowY: "auto",
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  hint: {
    fontFamily: "var(--font-serif)",
    fontSize: 13,
    color: "var(--text-tertiary)",
    lineHeight: 1.6,
    margin: 0,
  },
  resultCard: {
    border: "1px solid var(--border-subtle)",
    borderRadius: 6,
    overflow: "hidden",
    background: "var(--code-bg)",
  },
  resultHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    background: "var(--bg-elevated-2)",
    border: "none",
    padding: "7px 10px",
    fontSize: 11.5,
    fontFamily: "var(--font-mono)",
    textAlign: "left",
  },
  resultChevron: {
    color: "var(--text-tertiary)",
    fontSize: 10,
    flexShrink: 0,
  },
  resultPath: {
    color: "var(--text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
  },
  resultLines: {
    color: "var(--text-tertiary)",
    flexShrink: 0,
  },
  resultScore: {
    color: "var(--accent-sage)",
    flexShrink: 0,
    fontWeight: 600,
  },
  matchCount: {
    fontSize: 10,
    color: "rgba(255,210,0,0.8)",
    flexShrink: 0,
    fontFamily: "var(--font-mono)",
  },
  sourceLink: {
    display: "block",
    padding: "6px 10px",
    borderTop: "1px solid var(--border-subtle)",
    color: "var(--accent-rust)",
    fontSize: 10.5,
    textDecoration: "none",
  },
};
