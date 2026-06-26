import { useEffect, useId, useRef, useState } from "react";
import mermaid from "../utils/mermaid";
import { api } from "../api/client";

/** Convierte un nombre de módulo (puede tener / y .) en un id válido para mermaid. */
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
  const containerRef = useRef(null);
  const rawId = useId();
  const baseId = `depgraph-${rawId.replace(/:/g, "")}`;
  const renderSeq = useRef(0);

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
    return () => {
      cancelled = true;
    };
  }, [repositoryId]);

  useEffect(() => {
    if (!graph || !containerRef.current) return;
    const code = graphToMermaid(graph);
    if (!code) return;

    let cancelled = false;
    const renderId = `${baseId}-${++renderSeq.current}`;

    let timedOut = false;
    const tid = setTimeout(() => {
      timedOut = true;
      document.getElementById(`d${renderId}`)?.remove();
      if (!cancelled) setError("El grafo tardó más de 10 s en renderizarse.");
    }, 10_000);

    mermaid
      .render(renderId, code)
      .then(({ svg }) => {
        clearTimeout(tid);
        if (!cancelled && !timedOut && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      })
      .catch((err) => {
        clearTimeout(tid);
        document.getElementById(`d${renderId}`)?.remove();
        if (!cancelled) setError("No se pudo renderizar el grafo: " + (err?.message || err));
      });
    return () => {
      cancelled = true;
      clearTimeout(tid);
      document.getElementById(`d${renderId}`)?.remove();
    };
  }, [graph]);

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>grafo de dependencias entre módulos</span>
          <button onClick={onClose} style={styles.closeBtn}>
            ✕
          </button>
        </div>

        <div style={styles.body}>
          {loading && <p style={styles.hint}>Cargando grafo…</p>}
          {error && <div style={styles.errorBox}>{error}</div>}
          {!loading && !error && graph && graph.nodes.length === 0 && (
            <p style={styles.hint}>
              No se detectaron dependencias entre módulos. Esto puede pasar en proyectos
              muy pequeños, en lenguajes no soportados por el detector de imports, o si
              los módulos no se importan entre sí directamente.
            </p>
          )}
          {!loading && !error && graph && graph.nodes.length > 0 && (
            <>
              <p style={styles.subhint}>
                Flechas = dependencia detectada por imports/requires reales en el código.
                El número en la flecha indica cuántos imports hay entre esos dos módulos.
              </p>
              <div ref={containerRef} style={styles.diagramContainer} />
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
  diagramContainer: {
    display: "flex",
    justifyContent: "center",
    minHeight: 200,
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
