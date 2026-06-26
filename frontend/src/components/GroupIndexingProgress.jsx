import { useState, useEffect } from "react";
import { api } from "../api/client";

const TERMINAL = ["done", "failed"];

/**
 * Shows live progress of a group indexing job.
 * Polls the job endpoint until the job reaches a terminal state (done/failed).
 */
export function GroupIndexingProgress({ groupJobId, groupId, onDone }) {
  const [job, setJob] = useState(null);

  useEffect(() => {
    if (!groupJobId || !groupId) return;
    let cancelled = false;
    let intervalId = null;

    async function start() {
      try {
        const initial = await api.getGroupJob(groupId, groupJobId);
        if (cancelled) return;
        setJob(initial);
        if (TERMINAL.includes(initial.status)) {
          onDone(initial);
          return;
        }
      } catch { /* ignore */ }

      intervalId = setInterval(async () => {
        if (cancelled) { clearInterval(intervalId); return; }
        try {
          const updated = await api.getGroupJob(groupId, groupJobId);
          if (!cancelled) {
            setJob(updated);
            if (TERMINAL.includes(updated.status)) {
              clearInterval(intervalId);
              onDone(updated);
            }
          }
        } catch { /* ignore */ }
      }, 1500);
    }

    start();
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [groupJobId, groupId, onDone]);

  if (!job) {
    return (
      <div style={styles.wrapper}>
        <div style={styles.card}>
          <p style={styles.hint}>Iniciando indexado del grupo…</p>
        </div>
      </div>
    );
  }

  const total = Math.max(job.total_repos, 1);
  const done = job.completed_repos + job.failed_repos;
  const pct = Math.min(Math.round((done / total) * 100), 100);
  const isFailed = job.status === "failed";

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <div style={styles.eyebrow}>
          <span style={styles.dot} />
          atlas / indexando grupo
        </div>

        <h2 style={styles.title}>Indexando grupo</h2>
        <p style={styles.step}>{job.current_step || "Procesando..."}</p>

        <div style={styles.barTrack}>
          <div
            style={{
              ...styles.barFill,
              width: `${pct}%`,
              background: isFailed ? "var(--accent-red)" : "var(--accent-rust)",
            }}
          />
        </div>
        <p style={styles.pct}>
          {job.completed_repos} completados · {job.failed_repos} fallidos · {job.total_repos} total
        </p>

        {job.error_summary && (
          <div style={styles.errorBox}>
            <strong>Errores:</strong>
            <pre style={styles.errorPre}>{job.error_summary}</pre>
          </div>
        )}

        {job.repo_statuses && job.repo_statuses.length > 0 && (
          <div style={styles.repoList}>
            <p style={styles.repoListTitle}>Repositorios</p>
            {job.repo_statuses.map((rs) => (
              <div key={rs.id} style={styles.repoRow}>
                <span style={{ ...styles.statusDot, background: statusColor(rs.status) }} />
                <span style={styles.repoPath}>{rs.project_path}</span>
                <span style={{ ...styles.statusLabel, color: statusColor(rs.status) }}>
                  {rs.status}
                </span>
                {rs.error_message && (
                  <span style={styles.errorMsg} title={rs.error_message}>!</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function statusColor(status) {
  switch (status) {
    case "done": return "var(--accent-sage)";
    case "failed": return "var(--accent-red)";
    case "indexing": return "var(--accent-rust)";
    default: return "var(--text-tertiary)";
  }
}

const styles = {
  wrapper: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "32px 20px",
    background: "radial-gradient(circle at 20% 0%, rgba(201,124,74,0.08), transparent 45%), var(--bg-base)",
  },
  card: {
    width: "100%",
    maxWidth: 560,
  },
  eyebrow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    letterSpacing: "0.06em",
    color: "var(--text-tertiary)",
    marginBottom: 24,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "var(--accent-rust)",
    display: "inline-block",
  },
  title: {
    fontFamily: "var(--font-serif)",
    fontSize: 26,
    fontWeight: 600,
    margin: "0 0 8px",
    color: "var(--text-primary)",
  },
  step: {
    fontSize: 13,
    color: "var(--text-secondary)",
    margin: "0 0 20px",
  },
  hint: {
    fontFamily: "var(--font-serif)",
    fontSize: 15,
    color: "var(--text-secondary)",
  },
  barTrack: {
    height: 6,
    background: "var(--bg-elevated-2)",
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 8,
  },
  barFill: {
    height: "100%",
    borderRadius: 3,
    transition: "width 0.4s ease",
  },
  pct: {
    fontSize: 11.5,
    color: "var(--text-tertiary)",
    margin: "0 0 20px",
  },
  errorBox: {
    background: "rgba(192,89,74,0.12)",
    border: "1px solid var(--accent-red)",
    borderRadius: 6,
    padding: "10px 12px",
    fontSize: 12.5,
    color: "#E5A99A",
    marginBottom: 16,
  },
  errorPre: {
    margin: "6px 0 0",
    fontSize: 11,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  },
  repoList: {
    marginTop: 8,
    maxHeight: 320,
    overflowY: "auto",
    border: "1px solid var(--border-subtle)",
    borderRadius: 6,
    padding: "8px 0",
  },
  repoListTitle: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-tertiary)",
    letterSpacing: "0.04em",
    padding: "0 12px 6px",
    margin: 0,
    textTransform: "uppercase",
  },
  repoRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "5px 12px",
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    flexShrink: 0,
  },
  repoPath: {
    flex: 1,
    fontSize: 12,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  statusLabel: {
    fontSize: 10.5,
    flexShrink: 0,
  },
  errorMsg: {
    fontSize: 11,
    color: "var(--accent-red)",
    fontWeight: 700,
    cursor: "help",
  },
};
