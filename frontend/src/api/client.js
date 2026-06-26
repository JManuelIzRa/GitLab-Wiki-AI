/**
 * Minimal HTTP client for the Atlas backend.
 * Centralises the base URL, error handling, and retry logic (up to 2 retries
 * with exponential backoff on 5xx responses and network failures).
 */
export const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

class ApiError extends Error {
  constructor(message, status) {
    super(message);
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
      throw networkErr;
    }

    // Retry on 5xx, but not on the last attempt
    if (res.status >= 500 && attempt < MAX_RETRIES) continue;

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

  listRepositories: () => request("/api/repositories"),

  getWikiStructure: (repoId) => request(`/api/repositories/${repoId}/wiki`),

  getWikiPage: (repoId, slug) => request(`/api/repositories/${repoId}/wiki/${slug}`),

  updateWikiPage: (repoId, slug, contentMarkdown) =>
    request(`/api/repositories/${repoId}/wiki/${slug}`, {
      method: "PATCH",
      body: JSON.stringify({ content_markdown: contentMarkdown }),
    }),

  askQuestion: (repoId, question) =>
    request(`/api/repositories/${repoId}/chat`, { method: "POST", body: JSON.stringify({ question }) }),

  /**
   * Async generator that yields parsed SSE events from the streaming chat endpoint.
   * Yields: { token: string } for answer tokens, { sources: CodeSource[] } for source metadata.
   * Throws ApiError on HTTP error or stream-level error event.
   */
  streamAskQuestion: async function* (repoId, question) {
    const res = await fetch(`${API_BASE}/api/repositories/${repoId}/chat/stream`, {
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

  searchCode: (repoId, query, topK) =>
    request(`/api/repositories/${repoId}/search`, {
      method: "POST",
      body: JSON.stringify({ query, top_k: topK ?? null }),
    }),

  getExportUrl: (repoId) => `${API_BASE}/api/repositories/${repoId}/export`,

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
