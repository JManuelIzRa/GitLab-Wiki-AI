import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { gitLabCommitUrl } from "../utils/gitlab";

export function JobHistoryPanel({ repository, onClose }) {
  const trapRef = useFocusTrap();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [freshness, setFreshness] = useState(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    api.listRepositoryJobs(repository.id)
      .then(setJobs)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [repository.id]);

  const checkFreshness = async () => {
    setChecking(true); setError("");
    try { setFreshness(await api.checkRepositoryStaleness(repository.id)); }
    catch (err) { setError(err.message); }
    finally { setChecking(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <section ref={trapRef} className="history-panel" role="dialog" aria-modal="true" aria-label="Historial de indexado" onClick={(e) => e.stopPropagation()}>
        <header><div><strong>Historial de indexado</strong><small>{repository.project_path}</small></div><button onClick={onClose}>✕</button></header>
        <div className="freshness-row">
          <div>
            <span>Commit indexado </span>
            {gitLabCommitUrl(repository) ? <a href={gitLabCommitUrl(repository)} target="_blank" rel="noreferrer">{repository.last_commit_sha?.slice(0, 8)} ↗</a> : "—"}
          </div>
          <button onClick={checkFreshness} disabled={checking}>{checking ? "comprobando…" : "comprobar cambios"}</button>
        </div>
        {freshness && <div className={`freshness-badge ${freshness.stale ? "stale" : "current"}`}>{freshness.stale ? `Hay cambios (${freshness.remote_sha.slice(0, 8)})` : "Wiki al día"}</div>}
        {error && <div className="inline-error">{error}</div>}
        {loading ? <p>Cargando…</p> : (
          <ol className="job-list">{jobs.map((job) => (
            <li key={job.job_id}>
              <span className={`job-status ${job.status}`}>{job.status}</span>
              <div><strong>{job.current_step || `Job #${job.job_id}`}</strong><small>{job.created_at ? new Date(job.created_at).toLocaleString() : ""}</small>{job.error_message && <em>{job.error_message}</em>}</div>
            </li>
          ))}</ol>
        )}
      </section>
    </div>
  );
}
