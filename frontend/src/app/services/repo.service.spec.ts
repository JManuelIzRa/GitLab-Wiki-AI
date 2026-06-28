import { of, throwError } from 'rxjs';
import { Router } from '@angular/router';
import { ApiService, type RepositorySummary } from './api.service';
import { OfflineCacheService } from './offline-cache.service';
import { RepoService } from './repo.service';

const repository: RepositorySummary = {
  id: 7,
  gitlab_url: 'https://gitlab.com',
  project_path: 'deep/wiki',
  name: 'wiki',
  description: 'Test repository',
  default_branch: 'main',
  last_commit_sha: 'abc123',
  indexed_in_qdrant: true,
  is_monorepo: false,
  workspace_roots: null,
  webhook_secret: '',
  gitlab_token_set: false,
  system_prompt: '',
  prompt_overrides: null,
  wiki_language: 'es',
  updated_at: '2026-06-28T12:00:00Z',
};

describe('RepoService state synchronization', () => {
  let api: jasmine.SpyObj<ApiService>;
  let router: jasmine.SpyObj<Router>;
  let cache: jasmine.SpyObj<OfflineCacheService>;
  let service: RepoService;

  beforeEach(() => {
    localStorage.clear();
    api = jasmine.createSpyObj<ApiService>('ApiService', [
      'listRepositories',
      'getWikiStructure',
    ]);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    cache = jasmine.createSpyObj<OfflineCacheService>('OfflineCacheService', [
      'setRepositories',
      'getRepositories',
      'setStructure',
      'getStructure',
    ]);
    cache.setRepositories.and.resolveTo();
    cache.setStructure.and.resolveTo();
    cache.getRepositories.and.resolveTo(null);
    cache.getStructure.and.resolveTo(null);
    service = new RepoService(api, router, cache);
  });

  it('publishes repository results through its public signals', async () => {
    api.listRepositories.and.returnValue(of([repository]));

    await service.loadRepositories();

    expect(service.browseLoading()).toBeFalse();
    expect(service.repositories()).toEqual([repository]);
    expect(service.browseError()).toBe('');
  });

  it('publishes load failures instead of remaining in a loading state', async () => {
    api.listRepositories.and.returnValue(
      throwError(() => new Error('Servidor no disponible')),
    );

    await service.loadRepositories();

    expect(service.browseLoading()).toBeFalse();
    expect(service.browseError()).toContain('Servidor no disponible');
  });

  it('opens the first wiki page at a shareable URL', async () => {
    api.getWikiStructure.and.returnValue(of({
      repository,
      pages: [{ id: 1, slug: 'overview', title: 'Overview', order: 0, parent_slug: '' }],
    }));

    await service.openExistingRepository(repository);

    expect(service.activeSlug()).toBe('overview');
    expect(router.navigate).toHaveBeenCalledWith(['/wiki', 7, 'overview']);
  });
});
