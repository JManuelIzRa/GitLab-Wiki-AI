import { useState, useCallback } from "react";
import { api } from "../api/client";

function validateGitLabUrl(url) {
  if (!url.trim()) return "La URL es obligatoria";
  if (!/^https?:\/\/.+\..+/.test(url.trim())) return "La URL debe comenzar con http:// o https:// e incluir un dominio válido";
  return null;
}

function validateProjectPath(path) {
  if (!path.trim()) return "La ruta del proyecto es obligatoria";
  if (/[<>"\s]/.test(path.trim())) return "La ruta no puede contener espacios ni caracteres especiales";
  return null;
}

/**
 * Pantalla inicial: pide los datos de conexión a GitLab self-hosted o gitlab.com
 * y arranca el job de indexado al enviar.
 */
export function ConnectForm({ onSubmit, isSubmitting, errorMessage, onBack, prefill }) {
  const [gitlabUrl, setGitlabUrl] = useState(prefill?.gitlab_url || "https://gitlab.com");
  const [projectPath, setProjectPath] = useState(prefill?.project_path || "");
  const [privateToken, setPrivateToken] = useState("");
  const [branch, setBranch] = useState(prefill?.default_branch && prefill.default_branch !== "main" ? prefill.default_branch : "");
  const [showToken, setShowToken] = useState(false);
  const [branches, setBranches] = useState([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState("");
  const [urlError, setUrlError] = useState("");
  const [pathError, setPathError] = useState("");
  const isReindex = Boolean(prefill);

  const fetchBranches = useCallback(async () => {
    const urlErr = validateGitLabUrl(gitlabUrl);
    if (urlErr) { setBranchesError(urlErr); return; }
    if (!projectPath.trim() || !privateToken.trim()) {
      setBranchesError("Completa la ruta del proyecto y el token antes de cargar las ramas.");
      return;
    }
    setBranchesLoading(true);
    setBranchesError("");
    setBranches([]);
    try {
      const res = await api.listBranches(
        gitlabUrl.trim().replace(/\/+$/, ""),
        projectPath.trim().replace(/^\/+/, ""),
        privateToken.trim(),
      );
      setBranches(res.branches || []);
      if (!branch && res.branches?.length) setBranch(res.branches[0]);
    } catch (err) {
      setBranchesError(err.message || "No se pudieron cargar las ramas.");
    } finally {
      setBranchesLoading(false);
    }
  }, [gitlabUrl, projectPath, privateToken, branch]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const urlErr = validateGitLabUrl(gitlabUrl);
    const pathErr = validateProjectPath(projectPath);
    setUrlError(urlErr || "");
    setPathError(pathErr || "");
    if (urlErr || pathErr || !privateToken.trim()) return;
    onSubmit({
      gitlab_url: gitlabUrl.trim().replace(/\/+$/, ""),
      project_path: projectPath.trim().replace(/^\/+/, ""),
      private_token: privateToken.trim(),
      branch: branch.trim() || null,
      force_reindex: isReindex,
    });
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        {onBack && (
          <button onClick={onBack} style={styles.backLink}>
            ← ver repositorios indexados
          </button>
        )}
        <div style={styles.eyebrow}>
          <span style={styles.dot} />
          atlas / {isReindex ? "reindexar" : "nuevo índice"}
        </div>

        <h1 style={styles.title}>{isReindex ? "Reindexar repositorio" : "Indexa un repositorio"}</h1>
        <p style={styles.subtitle}>
          {isReindex
            ? "Vuelve a comprobar este repo. Si no hubo cambios desde el último indexado, el wiki existente se mantiene sin gastar tiempo ni tokens de más."
            : "Conecta cualquier instancia de GitLab —self-hosted o gitlab.com— y genera un wiki navegable a partir del código real del proyecto."}
        </p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <Field label="URL de la instancia GitLab" hint="ej. https://gitlab.tuempresa.com">
            <input
              type="text"
              value={gitlabUrl}
              onChange={(e) => { setGitlabUrl(e.target.value); setUrlError(""); }}
              placeholder="https://gitlab.com"
              style={{ ...styles.input, ...(isReindex ? styles.inputLocked : {}), ...(urlError ? styles.inputError : {}) }}
              disabled={isReindex}
              required
            />
            {urlError && <span style={styles.fieldError}>{urlError}</span>}
          </Field>

          <Field label="Ruta del proyecto" hint="grupo/subgrupo/proyecto, sin la URL">
            <input
              type="text"
              value={projectPath}
              onChange={(e) => { setProjectPath(e.target.value); setPathError(""); }}
              placeholder="mi-grupo/mi-proyecto"
              style={{ ...styles.input, ...(isReindex ? styles.inputLocked : {}), ...(pathError ? styles.inputError : {}) }}
              disabled={isReindex}
              required
            />
            {pathError && <span style={styles.fieldError}>{pathError}</span>}
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

          <Field label="Branch (opcional)" hint="omitir para usar el branch por defecto del repo">
            <div style={styles.tokenRow}>
              {branches.length > 0 ? (
                <select
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  style={{ ...styles.input, flex: 1 }}
                >
                  <option value="">(branch por defecto)</option>
                  {branches.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="main"
                  style={{ ...styles.input, flex: 1 }}
                />
              )}
              <button
                type="button"
                onClick={fetchBranches}
                disabled={branchesLoading}
                style={styles.toggleBtn}
                title="Cargar ramas disponibles del repositorio"
              >
                {branchesLoading ? "…" : "↓ ramas"}
              </button>
            </div>
            {branchesError && <span style={styles.branchError}>{branchesError}</span>}
          </Field>

          {errorMessage && <div style={styles.errorBox}>{errorMessage}</div>}

          <button type="submit" style={styles.submitBtn} disabled={isSubmitting}>
            {isSubmitting ? "Iniciando..." : isReindex ? "Comprobar y reindexar →" : "Generar wiki →"}
          </button>
        </form>

        <p style={styles.footnote}>
          El token nunca se almacena: se usa una sola vez para esta sesión de indexado.
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
  submitBtn: {
    background: "var(--accent-rust)",
    border: "none",
    borderRadius: 6,
    padding: "13px 16px",
    fontSize: 14,
    fontWeight: 600,
    color: "#1A1410",
    marginTop: 8,
    cursor: "pointer",
  },
  errorBox: {
    background: "rgba(192,89,74,0.12)",
    border: "1px solid var(--accent-red)",
    borderRadius: 6,
    padding: "10px 12px",
    fontSize: 12.5,
    color: "#E5A99A",
    lineHeight: 1.5,
  },
  footnote: {
    fontSize: 11.5,
    color: "var(--text-tertiary)",
    marginTop: 24,
    textAlign: "center",
  },
  branchError: {
    fontSize: 11,
    color: "var(--accent-red)",
    fontFamily: "var(--font-mono)",
  },
  fieldError: {
    fontSize: 11,
    color: "var(--accent-red)",
    fontFamily: "var(--font-mono)",
  },
  inputError: {
    borderColor: "var(--accent-red)",
  },
};
