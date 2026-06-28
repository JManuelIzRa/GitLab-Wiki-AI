export interface GitLabRepository {
  gitlab_url: string;
  project_path: string;
  last_commit_sha?: string;
  default_branch?: string;
}

/**
 * Build a GitLab source blob URL pointing to a specific file and optional line range.
 * Returns null if required fields are missing.
 */
export function gitLabSourceUrl(
  repository: GitLabRepository | null | undefined,
  filePath: string | null | undefined,
  startLine?: number | null,
  endLine?: number | null,
): string | null {
  if (!repository?.gitlab_url || !repository?.project_path || !filePath) return null;
  const project = repository.project_path
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  const ref = encodeURIComponent(
    repository.last_commit_sha || repository.default_branch || 'main',
  );
  const path = filePath
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  const lines = startLine
    ? `#L${startLine}${endLine && endLine !== startLine ? `-${endLine}` : ''}`
    : '';
  return `${repository.gitlab_url.replace(/\/$/, '')}/${project}/-/blob/${ref}/${path}${lines}`;
}

/**
 * Build a GitLab commit URL for the repository's latest commit.
 * Returns null if last_commit_sha is missing.
 */
export function gitLabCommitUrl(
  repository: GitLabRepository | null | undefined,
): string | null {
  if (!repository?.last_commit_sha) return null;
  const project = repository.project_path
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  return `${repository.gitlab_url.replace(/\/$/, '')}/${project}/-/commit/${repository.last_commit_sha}`;
}
