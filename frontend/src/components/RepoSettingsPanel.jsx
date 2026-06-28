import { useState } from "react";
import { api } from "../api/client";

export function RepoSettingsPanel({ repository, onClose }) {
  const [systemPrompt, setSystemPrompt] = useState(repository.system_prompt || "");
  const [gitlabToken, setGitlabToken] = useState("");
  const [wikiLanguage, setWikiLanguage] = useState(repository.wiki_language || "");
  const [promptOverridesRaw, setPromptOverridesRaw] = useState(
    repository.prompt_overrides ? JSON.stringify(repository.prompt_overrides, null, 2) : ""
  );
  const [promptOverridesError, setPromptOverridesError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    setPromptOverridesError("");
    let parsedOverrides = null;
    if (promptOverridesRaw.trim()) {
      try {
        parsedOverrides = JSON.parse(promptOverridesRaw);
      } catch {
        setPromptOverridesError("JSON inválido en los overrides de prompt.");
        return;
      }
    }
    setSaving(true);
    setError("");
    try {
      await Promise.all([
        api.setSystemPrompt(repository.id, systemPrompt),
        gitlabToken ? api.setGitLabToken(repository.id, gitlabToken) : Promise.resolve(),
        api.setWikiLanguage(repository.id, wikiLanguage),
        api.setPromptOverrides(repository.id, parsedOverrides),
      ]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message || "Error al guardar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={settingsStyles.overlay}>
      <div style={settingsStyles.panel}>
        <div style={settingsStyles.header}>
          <span style={settingsStyles.title}>Configuración del repo</span>
          <button onClick={onClose} style={settingsStyles.closeBtn}>✕</button>
        </div>

        <label style={settingsStyles.fieldLabel}>
          <span style={settingsStyles.fieldName}>Prompt de sistema personalizado</span>
          <span style={settingsStyles.fieldHint}>
            Reemplaza el prompt de sistema predeterminado del LLM al generar el wiki. Vacío = usar el predeterminado. Requiere re-indexar.
          </span>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            style={settingsStyles.textarea}
            placeholder="Eres un ingeniero senior que documenta repositorios de forma concisa y técnica..."
            rows={5}
          />
        </label>

        <label style={settingsStyles.fieldLabel}>
          <span style={settingsStyles.fieldName}>Token GitLab para webhooks</span>
          <span style={settingsStyles.fieldHint}>
            PAT almacenado en el servidor para re-indexado automático vía webhooks de GitLab. {repository.gitlab_token_set ? "✓ Ya configurado." : "No configurado."}
          </span>
          <input
            type="password"
            value={gitlabToken}
            onChange={(e) => setGitlabToken(e.target.value)}
            style={settingsStyles.input}
            placeholder={repository.gitlab_token_set ? "(dejar vacío para no cambiar)" : "glpat-xxxxxxxxxxxxxxxxxxxx"}
          />
        </label>

        <label style={settingsStyles.fieldLabel}>
          <span style={settingsStyles.fieldName}>Idioma del wiki (por repo)</span>
          <span style={settingsStyles.fieldHint}>
            Código ISO del idioma para generar el wiki de este repo (ej. "en", "fr", "de"). Vacío = usar el idioma global del servidor.
          </span>
          <input
            type="text"
            value={wikiLanguage}
            onChange={(e) => setWikiLanguage(e.target.value)}
            style={settingsStyles.input}
            placeholder="es, en, fr, de, pt… (vacío = global)"
            maxLength={8}
          />
        </label>

        <label style={settingsStyles.fieldLabel}>
          <span style={settingsStyles.fieldName}>Overrides de plantillas de prompt</span>
          <span style={settingsStyles.fieldHint}>
            JSON que sobreescribe claves específicas del prompt (overview, architecture, module, setup). Vacío = usar las plantillas del idioma configurado.
          </span>
          <textarea
            value={promptOverridesRaw}
            onChange={(e) => { setPromptOverridesRaw(e.target.value); setPromptOverridesError(""); }}
            style={{ ...settingsStyles.textarea, fontFamily: "var(--font-mono)", fontSize: 11 }}
            placeholder={'{\n  "overview": "Generate a concise overview…",\n  "setup": "Write setup steps…"\n}'}
            rows={5}
          />
          {promptOverridesError && <div style={{ ...settingsStyles.error, marginTop: 4 }}>{promptOverridesError}</div>}
        </label>

        {error && <div style={settingsStyles.error}>{error}</div>}
        <div style={settingsStyles.actions}>
          <button style={settingsStyles.saveBtn} onClick={handleSave} disabled={saving}>
            {saving ? "Guardando…" : saved ? "✓ Guardado" : "Guardar"}
          </button>
          <button style={settingsStyles.cancelBtn} onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

const settingsStyles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    zIndex: 300,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "flex-end",
  },
  panel: {
    width: 360,
    maxWidth: "90vw",
    height: "100vh",
    overflowY: "auto",
    background: "var(--bg-elevated)",
    borderLeft: "1px solid var(--border-subtle)",
    padding: "24px 18px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    fontFamily: "var(--font-mono)",
    color: "var(--text-primary)",
  },
  closeBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "var(--text-tertiary)",
    fontSize: 14,
    padding: 4,
  },
  fieldLabel: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
  },
  fieldName: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-secondary)",
    fontFamily: "var(--font-mono)",
  },
  fieldHint: {
    fontSize: 11,
    color: "var(--text-tertiary)",
    lineHeight: 1.4,
  },
  textarea: {
    width: "100%",
    background: "var(--bg-elevated-2)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 5,
    padding: "8px 10px",
    fontSize: 12,
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono)",
    resize: "vertical",
    outline: "none",
    lineHeight: 1.5,
    boxSizing: "border-box",
  },
  input: {
    width: "100%",
    background: "var(--bg-elevated-2)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 5,
    padding: "7px 10px",
    fontSize: 12,
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono)",
    outline: "none",
    boxSizing: "border-box",
  },
  error: {
    fontSize: 12,
    color: "var(--accent-red)",
    fontFamily: "var(--font-mono)",
    background: "rgba(192,89,74,0.1)",
    padding: "6px 10px",
    borderRadius: 4,
  },
  actions: {
    display: "flex",
    gap: 8,
  },
  saveBtn: {
    padding: "6px 16px",
    fontSize: 12,
    fontFamily: "var(--font-mono)",
    background: "var(--accent-rust)",
    color: "var(--accent-on-rust)",
    border: "none",
    borderRadius: 5,
    cursor: "pointer",
    fontWeight: 600,
  },
  cancelBtn: {
    padding: "6px 12px",
    fontSize: 12,
    fontFamily: "var(--font-mono)",
    background: "var(--bg-elevated-2)",
    color: "var(--text-secondary)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 5,
    cursor: "pointer",
  },
};

