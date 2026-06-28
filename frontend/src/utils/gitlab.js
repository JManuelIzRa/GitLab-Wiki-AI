export function gitLabSourceUrl(repository, filePath, startLine, endLine) {
  if (!repository?.gitlab_url || !repository?.project_path || !filePath) return null;
  const project = repository.project_path.split("/").map(encodeURIComponent).join("/");
  const ref = encodeURIComponent(repository.last_commit_sha || repository.default_branch || "main");
  const path = filePath.split("/").map(encodeURIComponent).join("/");
  const lines = startLine
    ? `#L${startLine}${endLine && endLine !== startLine ? `-${endLine}` : ""}`
    : "";
  return `${repository.gitlab_url.replace(/\/$/, "")}/${project}/-/blob/${ref}/${path}${lines}`;
}

export function gitLabCommitUrl(repository) {
  if (!repository?.last_commit_sha) return null;
  const project = repository.project_path.split("/").map(encodeURIComponent).join("/");
  return `${repository.gitlab_url.replace(/\/$/, "")}/${project}/-/commit/${repository.last_commit_sha}`;
}
