/**
 * Minimal HTTP client for the Atlas backend.
 * Centralises the base URL, error handling, and retry logic (up to 2 retries
 * with exponential backoff on 5xx responses and network failures).
 */
export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

class ApiError extends Error {
  constructor(message, status, options = undefined) {
    super(message, options);
    this.status = status;
  }
}

async function request(path, options = {}) {
  const MAX_RETRIES = 2;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
    }

    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        headers: { "Content-Type": "application/json" },
        ...options,
      });
    } catch (networkErr) {
      if (attempt < MAX_RETRIES) continue;
      throw new ApiError("No se pudo conectar con el servidor.", 0, { cause: networkErr });
    }

    // Only retry idempotent reads. Retrying an indexing/chat POST can duplicate work.
    const method = (options.method || "GET").toUpperCase();
    if (res.status >= 500 && attempt < MAX_RETRIES && ["GET", "HEAD"].includes(method)) continue;

    if (!res.ok) {
      let detail = `Error ${res.status}`;
      try {
        const body = await res.json();
        detail = body.detail || detail;
      } catch {
        /* respuesta sin cuerpo JSON */
      }
      throw new ApiError(detail, res.status);
    }

    if (res.status === 204) return null;
    return res.json();
  }
}

export const api = {
  indexRepository: (payload) =>
    request("/api/repositories/index", { method: "POST", body: JSON.stringify(payload) }),

  getJobStatus: (jobId) => request(`/api/jobs/${jobId}`),

  listRepositories: (offset = 0, limit = 100) =>
    request(`/api/repositories?offset=${offset}&limit=${limit}`),

  getWikiStructure: (repoId) => request(`/api/repositories/${repoId}/wiki`),

  getWikiPage: (repoId, slug) => request(`/api/repositories/${repoId}/wiki/${slug}`),

  updateWikiPage: (repoId, slug, contentMarkdown) =>
    request(`/api/repositories/${repoId}/wiki/${slug}`, {
      method: "PATCH",
      body: JSON.stringify({ content_markdown: contentMarkdown }),
    }),

  askQuestion: (repoId, question, history = []) =>
    request(`/api/repositories/${repoId}/chat`, {
      method: "POST",
      body: JSON.stringify({ question, history }),
    }),

  /**
   * Async generator that yields parsed SSE events from the streaming chat endpoint.
   * Yields: { token: string } for answer tokens, { sources: CodeSource[] } for source metadata.
   * Accepts an optional AbortSignal to stop mid-stream (yields AbortError on cancel).
   * Throws ApiError on HTTP error or stream-level error event.
   */
  streamAskQuestion: async function* (repoId, question, history = [], signal = undefined) {
    const res = await fetch(`${API_BASE}/api/repositories/${repoId}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, history }),
      signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(body.detail || `Error ${res.status}`, res.status);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "";
    let currentData = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            currentData += (currentData ? "\n" : "") + line.slice(6);
          } else if (line === "") {
            if (currentData) {
              try {
                const parsed = JSON.parse(currentData);
                if (currentEvent === "sources") {
                  yield { sources: parsed };
                } else if (currentEvent === "done") {
                  return;
                } else if (currentEvent === "error") {
                  throw new ApiError(parsed.message || "Stream error", 500);
                } else {
                  yield parsed;
                }
              } catch (e) {
                if (e instanceof ApiError) throw e;
              }
            }
            currentEvent = "";
            currentData = "";
          }
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
  },

  searchCode: (repoId, query, topK) =>
    request(`/api/repositories/${repoId}/search`, {
      method: "POST",
      body: JSON.stringify({ query, top_k: topK ?? null }),
    }),

  getExportUrl: (repoId) => `${API_BASE}/api/repositories/${repoId}/export`,

  getHtmlExportUrl: (repoId) => `${API_BASE}/api/repositories/${repoId}/export/html`,

  setWebhookSecret: (repoId, webhookSecret) =>
    request(`/api/repositories/${repoId}/webhook-secret`, {
      method: "PATCH",
      body: JSON.stringify({ webhook_secret: webhookSecret }),
    }),

  /** Store a per-repo PAT so GitLab webhooks can trigger re-indexing without a global default token. */
  setGitLabToken: (repoId, gitlabToken) =>
    request(`/api/repositories/${repoId}/gitlab-token`, {
      method: "PATCH",
      body: JSON.stringify({ gitlab_token: gitlabToken }),
    }),

  /** Set a custom LLM system prompt for this repo's wiki generation (empty = restore default). */
  setSystemPrompt: (repoId, systemPrompt) =>
    request(`/api/repositories/${repoId}/system-prompt`, {
      method: "PATCH",
      body: JSON.stringify({ system_prompt: systemPrompt }),
    }),

  /** Override specific prompt template keys (overview/architecture/module/setup) for this repo. */
  setPromptOverrides: (repoId, promptOverrides) =>
    request(`/api/repositories/${repoId}/prompt-overrides`, {
      method: "PATCH",
      body: JSON.stringify({ prompt_overrides: promptOverrides }),
    }),

  /** Set the wiki generation language for this repo (ISO code, e.g. "en", "fr"). Empty = global default. */
  setWikiLanguage: (repoId, wikiLanguage) =>
    request(`/api/repositories/${repoId}/wiki-language`, {
      method: "PATCH",
      body: JSON.stringify({ wiki_language: wikiLanguage }),
    }),

  /** Fetch available branches for a GitLab project (proxied through the backend). */
  listBranches: (gitlabUrl, projectPath, privateToken) =>
    request("/api/gitlab/branches", {
      method: "POST",
      body: JSON.stringify({ gitlab_url: gitlabUrl, project_path: projectPath, private_token: privateToken }),
    }),

  /** Full-text search across all wiki pages for a repository. */
  searchWikiText: (repoId, q) =>
    request(`/api/repositories/${repoId}/wiki-search?q=${encodeURIComponent(q)}`),

  listRepositoryJobs: (repoId, limit = 20) =>
    request(`/api/repositories/${repoId}/jobs?limit=${limit}`),

  regenerateWikiPage: (repoId, slug, privateToken = "") =>
    request(`/api/repositories/${repoId}/wiki/${slug}/regenerate`, {
      method: "POST",
      body: JSON.stringify({ private_token: privateToken }),
    }),

  checkRepositoryStaleness: (repoId, privateToken = "") =>
    request(`/api/repositories/${repoId}/staleness`, {
      method: "POST",
      body: JSON.stringify({ private_token: privateToken }),
    }),

  getServerConfig: () => request("/api/config"),

  getDependencyGraph: (repoId) => request(`/api/repositories/${repoId}/dependency-graph`),

  deleteRepository: (repoId) => request(`/api/repositories/${repoId}`, { method: "DELETE" }),

  /** Returns the revision history for a wiki page (newest first). */
  getWikiRevisions: (repoId, slug) =>
    request(`/api/repositories/${repoId}/wiki/${slug}/revisions`),

  /** Restores a wiki page to a specific revision. */
  restoreWikiRevision: (repoId, slug, revisionId) =>
    request(`/api/repositories/${repoId}/wiki/${slug}/revisions/${revisionId}/restore`, {
      method: "POST",
    }),

  /** Pushes all generated wiki pages to the repository's native GitLab wiki. */
  pushToGitLabWiki: (repoId, privateToken) =>
    request(`/api/repositories/${repoId}/push-to-gitlab-wiki`, {
      method: "POST",
      body: JSON.stringify({ private_token: privateToken }),
    }),

  // ---- Group endpoints ----

  /** Start indexing all repos in a GitLab group. */
  indexGroup: (payload) =>
    request("/api/groups/index", { method: "POST", body: JSON.stringify(payload) }),

  listGroups: () => request("/api/groups"),

  getGroup: (groupId) => request(`/api/groups/${groupId}`),

  getGroupJob: (groupId, jobId) => request(`/api/groups/${groupId}/jobs/${jobId}`),

  getGroupWiki: (groupId) => request(`/api/groups/${groupId}/wiki`),

  crossRepoSearch: (groupId, query, topK, repoIds) =>
    request(`/api/groups/${groupId}/search`, {
      method: "POST",
      body: JSON.stringify({ query, top_k: topK ?? 10, repo_ids: repoIds ?? null }),
    }),

  groupChat: (groupId, question) =>
    request(`/api/groups/${groupId}/chat`, {
      method: "POST",
      body: JSON.stringify({ question }),
    }),

  streamGroupChat: async function* (groupId, question) {
    const res = await fetch(`${API_BASE}/api/groups/${groupId}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(body.detail || `Error ${res.status}`, res.status);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "";
    let currentData = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          currentData += (currentData ? "\n" : "") + line.slice(6);
        } else if (line === "") {
          if (currentData) {
            try {
              const parsed = JSON.parse(currentData);
              if (currentEvent === "sources") {
                yield { sources: parsed };
              } else if (currentEvent === "done") {
                return;
              } else if (currentEvent === "error") {
                throw new ApiError(parsed.message || "Stream error", 500);
              } else {
                yield parsed;
              }
            } catch (e) {
              if (e instanceof ApiError) throw e;
            }
          }
          currentEvent = "";
          currentData = "";
        }
      }
    }
  },

  getGroupDependencyGraph: (groupId) => request(`/api/groups/${groupId}/dependency-graph`),

  deleteGroup: (groupId) => request(`/api/groups/${groupId}`, { method: "DELETE" }),
};

export { ApiError };
