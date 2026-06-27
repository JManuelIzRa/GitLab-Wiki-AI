const STAGES = [
  { key: "pending", label: "en cola" },
  { key: "cloning", label: "conectando con gitlab" },
  { key: "analyzing", label: "analizando estructura" },
  { key: "generating", label: "generando páginas con ia" },
  { key: "embedding", label: "indexando código en qdrant" },
  { key: "done", label: "listo" },
];

function stageIndex(status) {
  const idx = STAGES.findIndex((s) => s.key === status);
  return idx === -1 ? 0 : idx;
}

/**
 * Muestra el progreso del indexado como una secuencia de etapas tipo log de CI,
 * con la etapa actual resaltada y un detalle del paso específico en curso.
 */
export function IndexingProgress({ job, projectPath }) {
  const status = job?.status || "pending";
  const isFailed = status === "failed";
  const currentIdx = stageIndex(status);

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <div style={styles.eyebrow}>
          <span style={{ ...styles.dot, background: isFailed ? "var(--accent-red)" : "var(--accent-rust)" }} />
          {projectPath}
        </div>

        <h1 style={styles.title}>{isFailed ? "El indexado falló" : "Indexando repositorio"}</h1>

        <div style={styles.stageList}>
          {STAGES.map((stage, idx) => {
            let state = "pending";
            if (isFailed && idx === currentIdx) state = "failed";
            else if (idx < currentIdx) state = "done";
            else if (idx === currentIdx) state = "active";

            return (
              <div key={stage.key} style={styles.stageRow}>
                <StageIcon state={state} />
                <span
                  style={{
                    ...styles.stageLabel,
                    color:
                      state === "done"
                        ? "var(--text-secondary)"
                        : state === "active"
                        ? "var(--text-primary)"
                        : state === "failed"
                        ? "var(--accent-red)"
                        : "var(--text-tertiary)",
                    fontWeight: state === "active" ? 600 : 400,
                  }}
                >
                  {stage.label}
                </span>
                {state === "active" && job?.current_step && (
                  <span style={styles.stageDetail}>— {job.current_step}</span>
                )}
              </div>
            );
          })}
        </div>

        <div style={styles.progressBarTrack}>
          <div
            style={{
              ...styles.progressBarFill,
              width: `${job?.progress ?? 0}%`,
              background: isFailed ? "var(--accent-red)" : "var(--accent-rust)",
            }}
          />
        </div>
        <div style={styles.progressPct}>{job?.progress ?? 0}%</div>

        {isFailed && job?.error_message && (
          <div style={styles.errorBox}>
            <div style={styles.errorTitle}>detalle del error</div>
            {job.error_message}
          </div>
        )}
      </div>
    </div>
  );
}

function StageIcon({ state }) {
  if (state === "done") {
    return <span style={{ ...styles.iconBase, color: "var(--accent-sage)" }}>✓</span>;
  }
  if (state === "failed") {
    return <span style={{ ...styles.iconBase, color: "var(--accent-red)" }}>✕</span>;
  }
  if (state === "active") {
    return <span style={{ ...styles.iconBase, color: "var(--accent-rust)" }} className="pulse-dot">●</span>;
  }
  return <span style={{ ...styles.iconBase, color: "var(--border-strong)" }}>○</span>;
}

const styles = {
  wrapper: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "32px 20px",
  },
  card: {
    width: "100%",
    maxWidth: 480,
  },
  eyebrow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    letterSpacing: "0.02em",
    color: "var(--text-tertiary)",
    marginBottom: 24,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    display: "inline-block",
  },
  title: {
    fontFamily: "var(--font-serif)",
    fontSize: 28,
    fontWeight: 600,
    margin: "0 0 32px",
    color: "var(--text-primary)",
  },
  stageList: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    marginBottom: 28,
  },
  stageRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    fontSize: 13,
  },
  iconBase: {
    fontSize: 12,
    width: 14,
    display: "inline-block",
    textAlign: "center",
  },
  stageLabel: {
    minWidth: 150,
  },
  stageDetail: {
    color: "var(--text-tertiary)",
    fontSize: 12,
  },
  progressBarTrack: {
    height: 4,
    background: "var(--bg-elevated-2)",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    transition: "width 0.4s ease",
    borderRadius: 2,
  },
  progressPct: {
    fontSize: 11,
    color: "var(--text-tertiary)",
    marginTop: 8,
    textAlign: "right",
  },
  errorBox: {
    marginTop: 24,
    background: "rgba(192,89,74,0.1)",
    border: "1px solid var(--accent-red)",
    borderRadius: 6,
    padding: "12px 14px",
    fontSize: 12.5,
    color: "var(--text-error)",
    lineHeight: 1.6,
  },
  errorTitle: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    marginBottom: 6,
    color: "var(--accent-red)",
  },
};
