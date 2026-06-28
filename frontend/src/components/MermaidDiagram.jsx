import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, Download, X } from "lucide-react";
import mermaid, { MERMAID_DARK_VARS, MERMAID_LIGHT_VARS } from "../utils/mermaid";

export function MermaidDiagram({ code }) {
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

  const [mermaidTheme, setMermaidTheme] = useState(
    () => document.documentElement.getAttribute("data-theme") === "light" ? "default" : "dark"
  );

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

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e) => { if (e.key === "Escape") setZoomed(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [zoomed]);

  useEffect(() => {
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

const styles = {
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
};
