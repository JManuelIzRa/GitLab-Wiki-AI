import { useEffect, useId, useRef, useState } from "react";
import mermaid, { MERMAID_DARK_VARS, MERMAID_LIGHT_VARS } from "../utils/mermaid";
import { api } from "../api/client";

function sanitizeNodeId(name) {
  return "n_" + name.replace(/[^a-zA-Z0-9]/g, "_");
}

function graphToMermaid(graph) {
  if (!graph.nodes.length) return null;
  const lines = ["flowchart LR"];
  const idMap = new Map(graph.nodes.map((n) => [n, sanitizeNodeId(n)]));

  for (const node of graph.nodes) {
    lines.push(`  ${idMap.get(node)}["${node}"]`);
  }
  for (const edge of graph.edges) {
    const sourceId = idMap.get(edge.source);
    const targetId = idMap.get(edge.target);
    if (!sourceId || !targetId) continue;
    const label = edge.weight > 1 ? `|${edge.weight}|` : "";
    lines.push(`  ${sourceId} -->${label} ${targetId}`);
  }
  return lines.join("\n");
}

export function DependencyGraphView({ repositoryId, onClose }) {
  const [graph, setGraph] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [isRendering, setIsRendering] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef(null);
  const rawId = useId();
  const baseId = `depgraph-${rawId.replace(/:/g, "")}`;
  const renderSeq = useRef(0);

  // Track app theme so the diagram re-renders when the user switches dark/light
  const [mermaidTheme, setMermaidTheme] = useState(
    () => document.documentElement.getAttribute("data-theme") === "light" ? "default" : "dark"
  );
  useEffect(() => {
    const mo = new MutationObserver(() => {
      setMermaidTheme(
        document.documentElement.getAttribute("data-theme") === "light" ? "default" : "dark"
      );
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  // During-render pattern: reset isRendering when graph or theme changes,
  // avoiding synchronous setState inside useEffect.
  const [prevRenderKey, setPrevRenderKey] = useState({ graph, mermaidTheme });
  if ((prevRenderKey.graph !== graph || prevRenderKey.mermaidTheme !== mermaidTheme) && graph && graphToMermaid(graph)) {
    setPrevRenderKey({ graph, mermaidTheme });
    setIsRendering(true);
  }

  // Close on Escape key
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const res = await api.getDependencyGraph(repositoryId);
        if (!cancelled) setGraph(res);
      } catch (err) {
        if (!cancelled) setError(err.message || "No se pudo cargar el grafo de dependencias.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [repositoryId]);

  useEffect(() => {
    if (!graph || !containerRef.current) return;
    const code = graphToMermaid(graph);
    if (!code) return;

    let cancelled = false;
    const renderId = `${baseId}-${++renderSeq.current}`;

    mermaid.initialize({
      startOnLoad: false,
      theme: mermaidTheme,
      themeVariables: mermaidTheme === "default" ? MERMAID_LIGHT_VARS : MERMAID_DARK_VARS,
    });

    let timedOut = false;
    const tid = setTimeout(() => {
      timedOut = true;
      document.getElementById(`d${renderId}`)?.remove();
      if (!cancelled) {
        setError("El grafo tardó más de 10 s en renderizarse.");
        setIsRendering(false);
      }
    }, 10_000);

    mermaid
      .render(renderId, code)
      .then(({ svg }) => {
        clearTimeout(tid);
        if (!cancelled && !timedOut && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setIsRendering(false);
        }
      })
      .catch((err) => {
        clearTimeout(tid);
        document.getElementById(`d${renderId}`)?.remove();
        if (!cancelled) {
          setError("No se pudo renderizar el grafo: " + (err?.message || err));
          setIsRendering(false);
        }
      });
    return () => {
      cancelled = true;
      clearTimeout(tid);
      document.getElementById(`d${renderId}`)?.remove();
    };
  }, [baseId, graph, mermaidTheme]);

  const handleCopyCode = () => {
    if (!graph) return;
    const code = graphToMermaid(graph);
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const handleDownloadSVG = () => {
    const svg = containerRef.current?.innerHTML;
    if (!svg) return;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "dependency-graph.svg";
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasGraph = !loading && !error && graph && graph.nodes.length > 0;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>grafo de dependencias entre módulos</span>
          <div style={styles.headerActions}>
            {hasGraph && (
              <>
                <button
                  onClick={handleCopyCode}
                  style={{ ...styles.headerBtn, color: copied ? "var(--accent-sage)" : "var(--text-tertiary)" }}
                  title="Copiar código Mermaid"
                >
                  {copied ? "✓" : "⎘"} código
                </button>
                <button
                  onClick={handleDownloadSVG}
                  style={styles.headerBtn}
                  title="Descargar como SVG"
                  disabled={isRendering}
                >
                  ↓ svg
                </button>
              </>
            )}
            <button onClick={onClose} style={styles.closeBtn}>✕</button>
          </div>
        </div>

        <div style={styles.body}>
          {loading && (
            <div style={styles.skeletonWrapper}>
              <div style={styles.skeletonBar} />
            </div>
          )}
          {error && <div style={styles.errorBox}>{error}</div>}
          {!loading && !error && graph && graph.nodes.length === 0 && (
            <p style={styles.hint}>
              No se detectaron dependencias entre módulos. Esto puede pasar en proyectos
              muy pequeños, en lenguajes no soportados por el detector de imports, o si
              los módulos no se importan entre sí directamente.
            </p>
          )}
          {hasGraph && (
            <>
              <p style={styles.subhint}>
                {graph.nodes.length} módulos · {graph.edges.length} dependencias detectadas.{" "}
                Flechas = imports/requires reales; el número indica cuántos imports hay entre esos módulos.
              </p>
              <div style={styles.diagramWrapper}>
                {isRendering && (
                  <div style={styles.diagramLoadingOverlay}>
                    <div style={styles.diagramLoadingBar} />
                  </div>
                )}
                <div ref={containerRef} style={styles.diagramContainer} />
              </div>
            </>
          )}
        </div>
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
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
    padding: 20,
  },
  modal: {
    width: "100%",
    maxWidth: 880,
    maxHeight: "82vh",
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
    padding: "12px 16px",
    borderBottom: "1px solid var(--border-subtle)",
    gap: 12,
  },
  title: {
    fontSize: 12,
    letterSpacing: "0.05em",
    color: "var(--text-secondary)",
    flexShrink: 0,
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  headerBtn: {
    background: "var(--bg-elevated-2)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 4,
    padding: "3px 8px",
    fontSize: 11,
    fontFamily: "var(--font-mono)",
    cursor: "pointer",
    color: "var(--text-tertiary)",
  },
  closeBtn: {
    background: "none",
    border: "none",
    color: "var(--text-tertiary)",
    fontSize: 14,
    cursor: "pointer",
    padding: "2px 6px",
  },
  body: {
    flex: 1,
    overflow: "auto",
    padding: 20,
  },
  hint: {
    fontFamily: "var(--font-serif)",
    fontSize: 14,
    color: "var(--text-tertiary)",
    lineHeight: 1.6,
  },
  subhint: {
    fontSize: 11.5,
    color: "var(--text-tertiary)",
    marginBottom: 14,
  },
  diagramWrapper: {
    position: "relative",
    minHeight: 160,
  },
  diagramLoadingOverlay: {
    position: "absolute",
    inset: 0,
    borderRadius: 6,
    overflow: "hidden",
    background: "var(--bg-elevated-2)",
    zIndex: 1,
  },
  diagramLoadingBar: {
    position: "absolute",
    inset: 0,
    backgroundImage: "linear-gradient(90deg, transparent 0%, var(--bg-hover) 50%, transparent 100%)",
    backgroundSize: "200% 100%",
    animation: "shimmer 1.8s ease-in-out infinite",
  },
  diagramContainer: {
    display: "flex",
    justifyContent: "center",
    minHeight: 160,
  },
  skeletonWrapper: {
    borderRadius: 8,
    overflow: "hidden",
    height: 200,
    position: "relative",
    background: "var(--bg-elevated-2)",
  },
  skeletonBar: {
    position: "absolute",
    inset: 0,
    backgroundImage: "linear-gradient(90deg, transparent 0%, var(--bg-hover) 50%, transparent 100%)",
    backgroundSize: "200% 100%",
    animation: "shimmer 1.8s ease-in-out infinite",
  },
  errorBox: {
    background: "rgba(192,89,74,0.12)",
    border: "1px solid var(--accent-red)",
    borderRadius: 6,
    padding: "10px 12px",
    fontSize: 12.5,
    color: "#E5A99A",
  },
};
