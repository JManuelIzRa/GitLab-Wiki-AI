import { describe, expect, it } from 'vitest'
import { gitLabCommitUrl, gitLabSourceUrl } from '../utils/gitlab'

const repository = {
  gitlab_url: 'https://gitlab.example.com/',
  project_path: 'group/demo project',
  default_branch: 'main',
  last_commit_sha: 'abc123',
}

describe('GitLab links', () => {
  it('builds source links with encoded paths and line ranges', () => {
    expect(gitLabSourceUrl(repository, 'src/my file.js', 4, 8)).toBe(
      'https://gitlab.example.com/group/demo%20project/-/blob/abc123/src/my%20file.js#L4-8'
    )
  })

  it('builds commit links', () => {
    expect(gitLabCommitUrl(repository)).toBe(
      'https://gitlab.example.com/group/demo%20project/-/commit/abc123'
    )
  })
})
