import { useState } from "react";

/**
 * Form to start indexing a GitLab group (or subgroup).
 * The PAT is used for discovery + per-repo indexing and is never stored.
 */
export function GroupConnectForm({ onSubmit, isSubmitting, errorMessage, onBack, prefill }) {
  const [gitlabUrl, setGitlabUrl] = useState(prefill?.gitlab_url || "https://gitlab.com");
  const [groupPath, setGroupPath] = useState(prefill?.group_path || "");
  const [privateToken, setPrivateToken] = useState("");
  const [includeSubgroups, setIncludeSubgroups] = useState(true);
  const [showToken, setShowToken] = useState(false);
  const isReindex = Boolean(prefill);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!gitlabUrl.trim() || !groupPath.trim() || !privateToken.trim()) return;
    onSubmit({
      gitlab_url: gitlabUrl.trim().replace(/\/+$/, ""),
      group_path: groupPath.trim().replace(/^\/+/, ""),
      private_token: privateToken.trim(),
      include_subgroups: includeSubgroups,
      force_reindex: isReindex,
    });
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        {onBack && (
          <button onClick={onBack} style={styles.backLink}>
            ← volver
          </button>
        )}
        <div style={styles.eyebrow}>
          <span style={styles.dot} />
          DeepWiki · GitLab / {isReindex ? "reindexar grupo" : "nuevo grupo"}
        </div>

        <h1 style={styles.title}>{isReindex ? "Reindexar grupo" : "Indexar grupo de GitLab"}</h1>
        <p style={styles.subtitle}>
          {isReindex
            ? "Vuelve a descubrir y reindexar todos los repositorios del grupo. Los repos sin cambios se omiten."
            : "Conecta un grupo de GitLab para generar un wiki unificado con búsqueda semántica y chat cross-repo."}
        </p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <Field label="URL de la instancia GitLab" hint="ej. https://gitlab.tuempresa.com">
            <input
              type="text"
              value={gitlabUrl}
              onChange={(e) => setGitlabUrl(e.target.value)}
              placeholder="https://gitlab.com"
              style={{ ...styles.input, ...(isReindex ? styles.inputLocked : {}) }}
              disabled={isReindex}
              required
            />
          </Field>

          <Field label="Ruta del grupo" hint="ej. mi-empresa/equipo-backend (sin la URL base)">
            <input
              type="text"
              value={groupPath}
              onChange={(e) => setGroupPath(e.target.value)}
              placeholder="mi-empresa/mi-equipo"
              style={{ ...styles.input, ...(isReindex ? styles.inputLocked : {}) }}
              disabled={isReindex}
              required
            />
          </Field>

          <Field label="Personal Access Token" hint="scopes: read_api, read_repository">
            <div style={styles.tokenRow}>
              <input
                type={showToken ? "text" : "password"}
                value={privateToken}
                onChange={(e) => setPrivateToken(e.target.value)}
                placeholder="glpat-xxxxxxxxxxxxxxxxxxxx"
                style={{ ...styles.input, flex: 1 }}
                required
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                style={styles.toggleBtn}
                aria-label={showToken ? "Ocultar token" : "Mostrar token"}
              >
                {showToken ? "ocultar" : "ver"}
              </button>
            </div>
          </Field>

          <label style={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={includeSubgroups}
              onChange={(e) => setIncludeSubgroups(e.target.checked)}
              style={{ marginRight: 8 }}
            />
            <span style={styles.checkboxText}>Incluir subgrupos</span>
          </label>

          {errorMessage && <div style={styles.errorBox}>{errorMessage}</div>}

          <button type="submit" style={styles.submitBtn} disabled={isSubmitting}>
            {isSubmitting
              ? "Iniciando..."
              : isReindex
              ? "Reindexar grupo →"
              : "Indexar grupo →"}
          </button>
        </form>

        <p style={styles.footnote}>
          El token nunca se almacena: se usa para descubrir proyectos y luego para indexar cada repo.
        </p>
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label style={styles.fieldLabel}>
      <span style={styles.fieldLabelText}>{label}</span>
      {children}
      {hint && <span style={styles.fieldHint}>{hint}</span>}
    </label>
  );
}

const styles = {
  wrapper: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "32px 20px",
    background:
      "radial-gradient(circle at 20% 0%, rgba(201,124,74,0.08), transparent 45%), var(--bg-base)",
  },
  card: {
    width: "100%",
    maxWidth: 480,
  },
  backLink: {
    background: "none",
    border: "none",
    color: "var(--text-tertiary)",
    fontSize: 12,
    padding: 0,
    marginBottom: 20,
    display: "block",
    cursor: "pointer",
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
    fontSize: 34,
    fontWeight: 600,
    margin: "0 0 12px",
    color: "var(--text-primary)",
    letterSpacing: "-0.01em",
  },
  subtitle: {
    fontFamily: "var(--font-serif)",
    fontSize: 16,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
    margin: "0 0 36px",
    maxWidth: 440,
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
  },
  fieldLabel: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  fieldLabelText: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-secondary)",
    letterSpacing: "0.03em",
  },
  fieldHint: {
    fontSize: 11,
    color: "var(--text-tertiary)",
  },
  input: {
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 6,
    padding: "10px 12px",
    fontSize: 13,
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono)",
    width: "100%",
    outline: "none",
  },
  inputLocked: {
    opacity: 0.6,
    cursor: "not-allowed",
  },
  tokenRow: {
    display: "flex",
    gap: 8,
  },
  toggleBtn: {
    background: "var(--bg-elevated-2)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 6,
    padding: "0 14px",
    fontSize: 12,
    color: "var(--text-secondary)",
    cursor: "pointer",
  },
  checkboxLabel: {
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
  },
  checkboxText: {
    fontSize: 13,
    color: "var(--text-secondary)",
  },
  submitBtn: {
    background: "var(--accent-rust)",
    border: "none",
    borderRadius: 6,
    padding: "13px 16px",
    fontSize: 14,
    fontWeight: 600,
    color: "var(--accent-on-rust)",
    marginTop: 8,
    cursor: "pointer",
  },
  errorBox: {
    background: "rgba(192,89,74,0.12)",
    border: "1px solid var(--accent-red)",
    borderRadius: 6,
    padding: "10px 12px",
    fontSize: 12.5,
    color: "var(--text-error)",
    lineHeight: 1.5,
  },
  footnote: {
    fontSize: 11.5,
    color: "var(--text-tertiary)",
    marginTop: 24,
    textAlign: "center",
  },
};
