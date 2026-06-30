import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, timer } from 'rxjs';
import { catchError, mergeMap, retryWhen } from 'rxjs/operators';
import { environment } from '../../environments/environment';

// ==========================================================================
// Error class
// ==========================================================================

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ApiError';
    this.status = status;
  }
}

// ==========================================================================
// Request interfaces
// ==========================================================================

export interface IndexRepositoryRequest {
  gitlab_url: string;
  project_path: string;
  private_token: string;
  branch?: string | null;
  force_reindex?: boolean;
}

export interface ChatRequest {
  question: string;
  history?: ChatHistoryMessage[];
}

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CodeSearchRequest {
  query: string;
  top_k?: number | null;
}

export interface WikiPageUpdate {
  content_markdown: string;
}

export interface WebhookSecretUpdate {
  webhook_secret: string;
}

export interface GitLabTokenUpdate {
  gitlab_token: string;
}

export interface SystemPromptUpdate {
  system_prompt: string;
}

export interface PromptOverridesUpdate {
  prompt_overrides: Record<string, string> | null;
}

export interface WikiLanguageUpdate {
  wiki_language: string;
}

export interface BranchListRequest {
  gitlab_url: string;
  project_path: string;
  private_token: string;
}

export interface RegenerateWikiPageRequest {
  private_token: string;
}

export interface PushToGitLabWikiRequest {
  private_token: string;
}

export interface IndexGroupRequest {
  gitlab_url: string;
  group_path: string;
  private_token: string;
  force_reindex?: boolean;
  include_subgroups?: boolean;
}

export interface CrossRepoSearchRequest {
  query: string;
  top_k?: number;
  repo_ids?: number[] | null;
}

export interface GroupChatRequest {
  question: string;
}

// ==========================================================================
// Response interfaces
// ==========================================================================

export interface IndexJobResponse {
  job_id: number;
  repository_id: number;
  status: string;
  progress: number;
  current_step: string;
  error_message: string;
  created_at: string | null;
  finished_at: string | null;
}

export interface RepositorySummary {
  id: number;
  gitlab_url: string;
  project_path: string;
  name: string;
  description: string;
  default_branch: string;
  last_commit_sha: string;
  indexed_in_qdrant: boolean;
  is_monorepo: boolean;
  workspace_roots: string[] | null;
  webhook_secret: string;
  gitlab_token_set: boolean;
  system_prompt: string;
  prompt_overrides: Record<string, string> | null;
  wiki_language: string;
  updated_at: string;
}

export interface WikiPageSummary {
  id: number;
  slug: string;
  title: string;
  order: number;
  parent_slug: string;
}

export interface WikiPageDetail extends WikiPageSummary {
  content_markdown: string;
  source_files: string[];
  is_ai_generated: boolean;
}

export interface WikiStructureResponse {
  repository: RepositorySummary;
  pages: WikiPageSummary[];
}

export interface CodeSource {
  file_path: string;
  start_line: number;
  end_line: number;
  content: string;
  score: number;
}

export interface CodeSearchResponse {
  results: CodeSource[];
}

export interface ChatResponse {
  answer: string;
  sources: CodeSource[];
}

export interface WikiRevisionResponse {
  id: number;
  wiki_page_id: number;
  is_ai_generated: boolean;
  created_at: string;
  content_preview: string;
}

export interface DependencyGraphResponse {
  nodes: string[];
  edges: DependencyGraphEdge[];
}

export interface DependencyGraphEdge {
  source: string;
  target: string;
  weight: number;
}

export interface WikiTextSearchResult {
  slug: string;
  title: string;
  excerpt: string;
}

export interface PushToGitLabWikiResponse {
  ok: boolean;
  pages_pushed: number;
  errors: string[];
}

export interface GroupJobResponse {
  job_id: number;
  group_id: number;
  status: string;
  total_repos: number;
  completed_repos: number;
  failed_repos: number;
  current_step: string;
  error_summary: string;
  repo_statuses: GroupRepoStatusResponse[];
}

export interface GroupRepoStatusResponse {
  id: number;
  project_path: string;
  repository_id: number | null;
  status: string;
  error_message: string;
}

export interface GroupSummary {
  id: number;
  gitlab_url: string;
  group_path: string;
  gitlab_group_id: string;
  name: string;
  description: string;
  updated_at: string;
}

export interface GroupDetail extends GroupSummary {
  overview_markdown: string;
  repositories: RepositorySummary[];
  cross_repo_graph: Record<string, unknown>;
}

export interface CrossRepoSearchResult extends CodeSource {
  repository_id: number;
  repository_name: string;
  repository_path: string;
}

export interface CrossRepoSearchResponse {
  results: CrossRepoSearchResult[];
}

export interface ServerConfig {
  [key: string]: unknown;
}

// ==========================================================================
// Stream event types
// ==========================================================================

/** Event emitted during SSE streaming of chat responses. */
export interface StreamEvent {
  token?: string;
  sources?: CodeSource[];
}

// ==========================================================================
// Service
// ==========================================================================

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = environment.apiBaseUrl;

  // ------------------------------------------------------------------------
  // Internal request helper — retry + error mapping
  // ------------------------------------------------------------------------

  /**
   * Core request wrapper around HttpClient.
   * - Up to 2 retries with exponential backoff (500ms, 1000ms)
   * - Only retries GET/HEAD on 5xx server errors
   * - Retries all methods on network failures (status === 0)
   * - Converts HttpErrorResponse to ApiError
   */
  private request<T>(method: string, path: string, body?: unknown): Observable<T> {
    const url = `${this.apiBase}${path}`;
    const isBodyAllowed = method !== 'GET' && method !== 'HEAD';

    return this.http
      .request<T>(method, url, {
        ...(isBodyAllowed && body !== undefined ? { body } : {}),
        headers: { 'Content-Type': 'application/json' },
      })
      .pipe(
        retryWhen((errors) =>
          errors.pipe(
            mergeMap((error: HttpErrorResponse, idx: number) => {
              if (idx >= 2) {
                return throwError(() => error);
              }
              if (error instanceof HttpErrorResponse) {
                // Network error — retry all methods
                if (error.status === 0) {
                  return timer(500 * 2 ** idx);
                }
                // Server error — only retry idempotent reads
                if (error.status >= 500 && (method === 'GET' || method === 'HEAD')) {
                  return timer(500 * 2 ** idx);
                }
              }
              return throwError(() => error);
            }),
          ),
        ),
        catchError((error: HttpErrorResponse) => {
          let detail = `Error ${error.status}`;
          if (error.error && typeof error.error === 'object' && 'detail' in error.error) {
            const maybe = (error.error as Record<string, unknown>)['detail'];
            if (typeof maybe === 'string') {
              detail = maybe;
            }
          }
          return throwError(() => new ApiError(detail, error.status));
        }),
      );
  }

  // ------------------------------------------------------------------------
  // Repositories
  // ------------------------------------------------------------------------

  indexRepository(payload: IndexRepositoryRequest): Observable<{ job_id: number }> {
    return this.request<{ job_id: number }>('POST', '/api/repositories/index', payload);
  }

  getJobStatus(jobId: number): Observable<IndexJobResponse> {
    return this.request<IndexJobResponse>('GET', `/api/jobs/${jobId}`);
  }

  listRepositories(offset = 0, limit = 100): Observable<RepositorySummary[]> {
    return this.request<RepositorySummary[]>('GET', `/api/repositories?offset=${offset}&limit=${limit}`);
  }

  getWikiStructure(repoId: number): Observable<WikiStructureResponse> {
    return this.request<WikiStructureResponse>('GET', `/api/repositories/${repoId}/wiki`);
  }

  getWikiPage(repoId: number, slug: string): Observable<WikiPageDetail> {
    return this.request<WikiPageDetail>('GET', `/api/repositories/${repoId}/wiki/${slug}`);
  }

  updateWikiPage(repoId: number, slug: string, contentMarkdown: string): Observable<WikiPageDetail> {
    return this.request<WikiPageDetail>('PATCH', `/api/repositories/${repoId}/wiki/${slug}`, {
      content_markdown: contentMarkdown,
    });
  }

  askQuestion(
    repoId: number,
    question: string,
    history: ChatHistoryMessage[] = [],
  ): Observable<ChatResponse> {
    return this.request<ChatResponse>('POST', `/api/repositories/${repoId}/chat`, {
      question,
      history,
    });
  }

  searchCode(
    repoId: number,
    query: string,
    topK?: number | null,
  ): Observable<CodeSearchResponse> {
    return this.request<CodeSearchResponse>('POST', `/api/repositories/${repoId}/search`, {
      query,
      top_k: topK ?? null,
    });
  }

  getExportUrl(repoId: number): string {
    return `${this.apiBase}/api/repositories/${repoId}/export`;
  }

  getHtmlExportUrl(repoId: number): string {
    return `${this.apiBase}/api/repositories/${repoId}/export/html`;
  }

  setWebhookSecret(repoId: number, webhookSecret: string): Observable<unknown> {
    return this.request('PATCH', `/api/repositories/${repoId}/webhook-secret`, {
      webhook_secret: webhookSecret,
    });
  }

  setGitLabToken(repoId: number, gitlabToken: string): Observable<unknown> {
    return this.request('PATCH', `/api/repositories/${repoId}/gitlab-token`, {
      gitlab_token: gitlabToken,
    });
  }

  setSystemPrompt(repoId: number, systemPrompt: string): Observable<unknown> {
    return this.request('PATCH', `/api/repositories/${repoId}/system-prompt`, {
      system_prompt: systemPrompt,
    });
  }

  setPromptOverrides(
    repoId: number,
    promptOverrides: Record<string, string> | null,
  ): Observable<unknown> {
    return this.request('PATCH', `/api/repositories/${repoId}/prompt-overrides`, {
      prompt_overrides: promptOverrides,
    });
  }

  setWikiLanguage(repoId: number, wikiLanguage: string): Observable<unknown> {
    return this.request('PATCH', `/api/repositories/${repoId}/wiki-language`, {
      wiki_language: wikiLanguage,
    });
  }

  listBranches(
    gitlabUrl: string,
    projectPath: string,
    privateToken: string,
  ): Observable<string[]> {
    return this.request<string[]>('POST', '/api/gitlab/branches', {
      gitlab_url: gitlabUrl,
      project_path: projectPath,
      private_token: privateToken,
    });
  }

  searchWikiText(repoId: number, q: string): Observable<WikiTextSearchResult[]> {
    return this.request<WikiTextSearchResult[]>(
      'GET',
      `/api/repositories/${repoId}/wiki-search?q=${encodeURIComponent(q)}`,
    );
  }

  listRepositoryJobs(repoId: number, limit = 20): Observable<IndexJobResponse[]> {
    return this.request<IndexJobResponse[]>(
      'GET',
      `/api/repositories/${repoId}/jobs?limit=${limit}`,
    );
  }

  regenerateWikiPage(
    repoId: number,
    slug: string,
    privateToken = '',
  ): Observable<WikiPageDetail> {
    return this.request<WikiPageDetail>(
      'POST',
      `/api/repositories/${repoId}/wiki/${slug}/regenerate`,
      { private_token: privateToken },
    );
  }

  checkRepositoryStaleness(
    repoId: number,
    privateToken = '',
  ): Observable<unknown> {
    return this.request('POST', `/api/repositories/${repoId}/staleness`, {
      private_token: privateToken,
    });
  }

  getServerConfig(): Observable<ServerConfig> {
    return this.request<ServerConfig>('GET', '/api/config');
  }

  getDependencyGraph(repoId: number): Observable<DependencyGraphResponse> {
    return this.request<DependencyGraphResponse>(
      'GET',
      `/api/repositories/${repoId}/dependency-graph`,
    );
  }

  deleteRepository(repoId: number): Observable<void> {
    return this.request<void>('DELETE', `/api/repositories/${repoId}`);
  }

  getWikiRevisions(repoId: number, slug: string): Observable<WikiRevisionResponse[]> {
    return this.request<WikiRevisionResponse[]>(
      'GET',
      `/api/repositories/${repoId}/wiki/${slug}/revisions`,
    );
  }

  restoreWikiRevision(
    repoId: number,
    slug: string,
    revisionId: number,
  ): Observable<unknown> {
    return this.request(
      'POST',
      `/api/repositories/${repoId}/wiki/${slug}/revisions/${revisionId}/restore`,
    );
  }

  pushToGitLabWiki(
    repoId: number,
    privateToken: string,
  ): Observable<PushToGitLabWikiResponse> {
    return this.request<PushToGitLabWikiResponse>(
      'POST',
      `/api/repositories/${repoId}/push-to-gitlab-wiki`,
      { private_token: privateToken },
    );
  }

  // ------------------------------------------------------------------------
  // Groups
  // ------------------------------------------------------------------------

  indexGroup(
    payload: IndexGroupRequest,
  ): Observable<{ job_id: number; group_id: number }> {
    return this.request<{ job_id: number; group_id: number }>(
      'POST',
      '/api/groups/index',
      payload,
    );
  }

  listGroups(): Observable<GroupSummary[]> {
    return this.request<GroupSummary[]>('GET', '/api/groups');
  }

  getGroup(groupId: number): Observable<GroupDetail> {
    return this.request<GroupDetail>('GET', `/api/groups/${groupId}`);
  }

  getGroupJob(groupId: number, jobId: number): Observable<GroupJobResponse> {
    return this.request<GroupJobResponse>(
      'GET',
      `/api/groups/${groupId}/jobs/${jobId}`,
    );
  }

  getGroupWiki(groupId: number): Observable<WikiStructureResponse> {
    return this.request<WikiStructureResponse>('GET', `/api/groups/${groupId}/wiki`);
  }

  crossRepoSearch(
    groupId: number,
    query: string,
    topK?: number,
    repoIds?: number[] | null,
  ): Observable<CrossRepoSearchResponse> {
    return this.request<CrossRepoSearchResponse>(
      'POST',
      `/api/groups/${groupId}/search`,
      {
        query,
        top_k: topK ?? 10,
        repo_ids: repoIds ?? null,
      },
    );
  }

  groupChat(groupId: number, question: string): Observable<ChatResponse> {
    return this.request<ChatResponse>('POST', `/api/groups/${groupId}/chat`, {
      question,
    });
  }

  getGroupDependencyGraph(groupId: number): Observable<DependencyGraphResponse> {
    return this.request<DependencyGraphResponse>(
      'GET',
      `/api/groups/${groupId}/dependency-graph`,
    );
  }

  deleteGroup(groupId: number): Observable<void> {
    return this.request<void>('DELETE', `/api/groups/${groupId}`);
  }

  // ------------------------------------------------------------------------
  // SSE streaming (POST-based, uses native fetch wrapped in Observable)
  // ------------------------------------------------------------------------

  /**
   * Stream a chat answer via SSE for a single repository.
   * Emits StreamEvent tokens and sources, completes on the server's "done" event,
   * or errors on the server's "error" event / HTTP failure.
   *
   * The returned observable's unsubscribe triggers an AbortController signal
   * to cancel the underlying fetch.
   */
  streamAskQuestion(
    repoId: number,
    question: string,
    history: ChatHistoryMessage[] = [],
  ): Observable<StreamEvent> {
    return this.streamPost<StreamEvent>(`/api/repositories/${repoId}/chat/stream`, {
      question,
      history,
    });
  }

  /**
   * Stream a group chat answer via SSE.
   */
  streamGroupChat(groupId: number, question: string): Observable<StreamEvent> {
    return this.streamPost<StreamEvent>(`/api/groups/${groupId}/chat/stream`, {
      question,
    });
  }

  /**
   * Shared SSE helper: POST JSON to `path`, parse the SSE stream, and yield
   * events into an RxJS Observable.  Unsubscribe → abort the fetch.
   */
  private streamPost<T extends StreamEvent>(
    path: string,
    body: Record<string, unknown>,
  ): Observable<T> {
    const url = `${this.apiBase}${path}`;

    return new Observable<T>((subscriber) => {
      const abortController = new AbortController();
      let cancelled = false;

      (async () => {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: abortController.signal,
          });

          if (!res.ok) {
            let detail = `Error ${res.status}`;
            try {
              const json = await res.json();
              if (json && typeof json === 'object' && typeof json.detail === 'string') {
                detail = json.detail;
              }
            } catch {
              /* no JSON body */
            }
            subscriber.error(new ApiError(detail, res.status));
            return;
          }

          const reader = res.body?.getReader();
          if (!reader) {
            subscriber.error(new ApiError('Response body is not readable', 0));
            return;
          }

          const decoder = new TextDecoder();
          let buffer = '';
          let currentEvent = '';
          let currentData = '';

          while (!cancelled) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              if (line.startsWith('event: ')) {
                currentEvent = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                currentData += (currentData ? '\n' : '') + line.slice(6);
              } else if (line === '') {
                if (currentData) {
                  try {
                    const parsed = JSON.parse(currentData);
                    if (currentEvent === 'sources') {
                      subscriber.next({ sources: parsed } as T);
                    } else if (currentEvent === 'done') {
                      subscriber.complete();
                      return;
                    } else if (currentEvent === 'error') {
                      subscriber.error(
                        new ApiError(parsed.message ?? 'Stream error', 500),
                      );
                      return;
                    } else {
                      // Default: token event (parsed = { token: string })
                      subscriber.next(parsed as T);
                    }
                  } catch (e) {
                    if (e instanceof ApiError) throw e;
                    // Silently skip malformed JSON
                  }
                }
                currentEvent = '';
                currentData = '';
              }
            }
          }

          subscriber.complete();
        } catch (err: unknown) {
          if (cancelled) return; // Unsubscribe-triggered abort is intentional
          if (err instanceof Error && err.name === 'AbortError') return;
          subscriber.error(
            err instanceof ApiError ? err : new ApiError(String(err), 0),
          );
        }
      })();

      // Teardown: cancel the fetch when the consumer unsubscribes
      return () => {
        cancelled = true;
        abortController.abort();
      };
    });
  }
}
