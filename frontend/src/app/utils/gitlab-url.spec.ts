import { gitLabSourceUrl, gitLabCommitUrl } from './gitlab-url';

const repository = {
  gitlab_url: 'https://gitlab.example.com/',
  project_path: 'group/demo project',
  default_branch: 'main',
  last_commit_sha: 'abc123',
};

describe('gitLabSourceUrl', () => {
  it('builds source links with encoded paths and line ranges', () => {
    expect(gitLabSourceUrl(repository, 'src/my file.js', 4, 8)).toBe(
      'https://gitlab.example.com/group/demo%20project/-/blob/abc123/src/my%20file.js#L4-8',
    );
  });

  it('returns null for missing repo', () => {
    expect(gitLabSourceUrl(null, 'file.js', 1)).toBeNull();
  });

  it('returns null for missing file path', () => {
    expect(gitLabSourceUrl(repository, null)).toBeNull();
  });
});

describe('gitLabCommitUrl', () => {
  it('builds commit links', () => {
    expect(gitLabCommitUrl(repository)).toBe(
      'https://gitlab.example.com/group/demo%20project/-/commit/abc123',
    );
  });

  it('returns null when last_commit_sha is missing', () => {
    expect(gitLabCommitUrl({ ...repository, last_commit_sha: undefined })).toBeNull();
  });
});
