import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  ApiService,
  type RepositorySummary,
  type WikiPageSummary,
  type WikiPageDetail,
  type WikiStructureResponse,
  type IndexRepositoryRequest,
} from './api.service';
import { OfflineCacheService } from './offline-cache.service';
import { firstValueFrom } from 'rxjs';

// OfflineCacheService uses its own structurally-compatible but nominally-distinct
// types for WikiStructureResponse, WikiPageDetail, etc. Interop casts below are
// safe because IndexedDB serialises everything as a JSON blob. */

const REPOS_PAGE_SIZE = 20;
const STORAGE_JOB_ID = 'activeJobId';
const STORAGE_JOB_PATH = 'activeJobPath';
const STORAGE_LAST_REPO = 'lastRepoId';

interface RepoServiceState {
  repositories: RepositorySummary[];
  browseLoading: boolean;
  browseError: string;
  hasMoreRepos: boolean;
  repoLoadingMore: boolean;

  repository: RepositorySummary | null;
  pages: WikiPageSummary[];
  activeSlug: string | null;
  activePage: WikiPageDetail | null;
  pageLoading: boolean;

  submitError: string;
  isSubmitting: boolean;
  activeJobId: number | null;
  projectPathLabel: string;
  reindexPrefill: RepositorySummary | null;

  searchOpen: boolean;
  graphOpen: boolean;
  shortcutsOpen: boolean;
  historyOpen: boolean;
  paletteOpen: boolean;
}

function readStoredJobId(): number | null {
  const raw = localStorage.getItem(STORAGE_JOB_ID);
  return raw ? Number(raw) : null;
}

const initialState: RepoServiceState = {
  repositories: [],
  browseLoading: true,
  browseError: '',
  hasMoreRepos: false,
  repoLoadingMore: false,

  repository: null,
  pages: [],
  activeSlug: null,
  activePage: null,
  pageLoading: false,

  submitError: '',
  isSubmitting: false,
  activeJobId: readStoredJobId(),
  projectPathLabel: localStorage.getItem(STORAGE_JOB_PATH) || '',
  reindexPrefill: null,

  searchOpen: false,
  graphOpen: false,
  shortcutsOpen: false,
  historyOpen: false,
  paletteOpen: false,
};

@Injectable({ providedIn: 'root' })
export class RepoService {
  // ---- Readonly signals ----
  readonly repositories = signal<RepositorySummary[]>(initialState.repositories).asReadonly();
  readonly browseLoading = signal<boolean>(initialState.browseLoading).asReadonly();
  readonly browseError = signal<string>(initialState.browseError).asReadonly();
  readonly hasMoreRepos = signal<boolean>(initialState.hasMoreRepos).asReadonly();
  readonly repoLoadingMore = signal<boolean>(initialState.repoLoadingMore).asReadonly();

  readonly repository = signal<RepositorySummary | null>(initialState.repository).asReadonly();
  readonly pages = signal<WikiPageSummary[]>(initialState.pages).asReadonly();
  readonly activeSlug = signal<string | null>(initialState.activeSlug).asReadonly();
  readonly activePage = signal<WikiPageDetail | null>(initialState.activePage).asReadonly();
  readonly pageLoading = signal<boolean>(initialState.pageLoading).asReadonly();

  readonly submitError = signal<string>(initialState.submitError);
  readonly isSubmitting = signal<boolean>(initialState.isSubmitting).asReadonly();
  readonly activeJobId = signal<number | null>(initialState.activeJobId).asReadonly();
  readonly projectPathLabel = signal<string>(initialState.projectPathLabel).asReadonly();
  readonly reindexPrefill = signal<RepositorySummary | null>(initialState.reindexPrefill).asReadonly();

  readonly searchOpen = signal<boolean>(initialState.searchOpen).asReadonly();
  readonly graphOpen = signal<boolean>(initialState.graphOpen).asReadonly();
  readonly shortcutsOpen = signal<boolean>(initialState.shortcutsOpen).asReadonly();
  readonly historyOpen = signal<boolean>(initialState.historyOpen).asReadonly();
  readonly paletteOpen = signal<boolean>(initialState.paletteOpen).asReadonly();

  // ---- Private writable signals (for setState) ----
  private _repositories = signal<RepositorySummary[]>(initialState.repositories);
  private _browseLoading = signal<boolean>(initialState.browseLoading);
  private _browseError = signal<string>(initialState.browseError);
  private _hasMoreRepos = signal<boolean>(initialState.hasMoreRepos);
  private _repoLoadingMore = signal<boolean>(initialState.repoLoadingMore);

  private _repository = signal<RepositorySummary | null>(initialState.repository);
  private _pages = signal<WikiPageSummary[]>(initialState.pages);
  private _activeSlug = signal<string | null>(initialState.activeSlug);
  private _activePage = signal<WikiPageDetail | null>(initialState.activePage);
  private _pageLoading = signal<boolean>(initialState.pageLoading);

  private _submitError = signal<string>(initialState.submitError);
  private _isSubmitting = signal<boolean>(initialState.isSubmitting);
  private _activeJobId = signal<number | null>(initialState.activeJobId);
  private _projectPathLabel = signal<string>(initialState.projectPathLabel);
  private _reindexPrefill = signal<RepositorySummary | null>(initialState.reindexPrefill);

  private _searchOpen = signal<boolean>(initialState.searchOpen);
  private _graphOpen = signal<boolean>(initialState.graphOpen);
  private _shortcutsOpen = signal<boolean>(initialState.shortcutsOpen);
  private _historyOpen = signal<boolean>(initialState.historyOpen);
  private _paletteOpen = signal<boolean>(initialState.paletteOpen);

  // Snapshot for synchronous reads
  private snap: RepoServiceState = { ...initialState };

  constructor(
    private api: ApiService,
    private router: Router,
    private offlineCache: OfflineCacheService,
  ) {}

  private setState(partial: Partial<RepoServiceState>): void {
    this.snap = { ...this.snap, ...partial };
    if (partial.repositories !== undefined) this._repositories.set(partial.repositories);
    if (partial.browseLoading !== undefined) this._browseLoading.set(partial.browseLoading);
    if (partial.browseError !== undefined) this._browseError.set(partial.browseError);
    if (partial.hasMoreRepos !== undefined) this._hasMoreRepos.set(partial.hasMoreRepos);
    if (partial.repoLoadingMore !== undefined) this._repoLoadingMore.set(partial.repoLoadingMore);
    if (partial.repository !== undefined) this._repository.set(partial.repository);
    if (partial.pages !== undefined) this._pages.set(partial.pages);
    if (partial.activeSlug !== undefined) this._activeSlug.set(partial.activeSlug);
    if (partial.activePage !== undefined) this._activePage.set(partial.activePage);
    if (partial.pageLoading !== undefined) this._pageLoading.set(partial.pageLoading);
    if (partial.submitError !== undefined) this._submitError.set(partial.submitError);
    if (partial.isSubmitting !== undefined) this._isSubmitting.set(partial.isSubmitting);
    if (partial.activeJobId !== undefined) this._activeJobId.set(partial.activeJobId);
    if (partial.projectPathLabel !== undefined) this._projectPathLabel.set(partial.projectPathLabel);
    if (partial.reindexPrefill !== undefined) this._reindexPrefill.set(partial.reindexPrefill);
    if (partial.searchOpen !== undefined) this._searchOpen.set(partial.searchOpen);
    if (partial.graphOpen !== undefined) this._graphOpen.set(partial.graphOpen);
    if (partial.shortcutsOpen !== undefined) this._shortcutsOpen.set(partial.shortcutsOpen);
    if (partial.historyOpen !== undefined) this._historyOpen.set(partial.historyOpen);
    if (partial.paletteOpen !== undefined) this._paletteOpen.set(partial.paletteOpen);
  }

  // --------------------------------------------------------------------------
  // Browse (repository list)
  // --------------------------------------------------------------------------

  async loadRepositories(): Promise<void> {
    this.setState({ browseLoading: true, browseError: '' });
    try {
      const repos = await firstValueFrom(
        this.api.listRepositories(0, REPOS_PAGE_SIZE + 1),
      );
      await this.offlineCache.setRepositories(repos as any);
      const hasMore = repos.length > REPOS_PAGE_SIZE;
      this.setState({
        repositories: hasMore ? repos.slice(0, REPOS_PAGE_SIZE) : repos,
        hasMoreRepos: hasMore,
        browseLoading: false,
      });
    } catch (err) {
      const cached = await this.offlineCache.getRepositories();
      if (cached) {
        const typed = cached as unknown as RepositorySummary[];
        const hasMore = typed.length > REPOS_PAGE_SIZE;
        this.setState({
          repositories: hasMore ? typed.slice(0, REPOS_PAGE_SIZE) : typed,
          hasMoreRepos: hasMore,
          browseLoading: false,
          browseError:
            'Servidor no disponible; mostrando repositorios guardados sin conexión.',
        });
      } else {
        this.setState({
          browseLoading: false,
          browseError:
            (err instanceof Error ? err.message : String(err)) ||
            'No se pudo cargar la lista de repositorios.',
        });
      }
    }
  }

  async loadMoreRepositories(): Promise<void> {
    this.setState({ repoLoadingMore: true });
    try {
      const more = await firstValueFrom(
        this.api.listRepositories(this.snap.repositories.length, REPOS_PAGE_SIZE + 1),
      );
      const hasMore = more.length > REPOS_PAGE_SIZE;
      this.setState({
        repositories: [
          ...this.snap.repositories,
          ...(hasMore ? more.slice(0, REPOS_PAGE_SIZE) : more),
        ],
        hasMoreRepos: hasMore,
        repoLoadingMore: false,
      });
    } catch (err) {
      this.setState({
        browseError: (err instanceof Error ? err.message : String(err)) || 'No se pudieron cargar más repositorios.',
        repoLoadingMore: false,
      });
    }
  }

  // --------------------------------------------------------------------------
  // Wiki (open / navigate pages)
  // --------------------------------------------------------------------------

  /** Open an existing repository — load its wiki structure with offline fallback. */
  async openExistingRepository(repo: RepositorySummary): Promise<void> {
    try {
      let structure: WikiStructureResponse;
      try {
        structure = await firstValueFrom(this.api.getWikiStructure(repo.id));
        await this.offlineCache.setStructure(repo.id, structure as any);
      } catch (netErr) {
        const cached = await this.offlineCache.getStructure(repo.id);
        if (cached) {
          structure = cached as any;
        } else {
          throw netErr;
        }
      }
      this.setState({
        repository: structure.repository ?? repo,
        pages: structure.pages,
        activeSlug: structure.pages[0]?.slug || null,
        activePage: null,
        pageLoading: false,
      });
      localStorage.setItem(STORAGE_LAST_REPO, String(repo.id));
    } catch (err) {
      this.setState({
        browseError: `Error al abrir "${repo.name}": ${err instanceof Error ? err.message : 'Error desconocido'}`,
      });
    }
  }

  /** Navigate to previous/next wiki page by offset. */
  navigatePage(offset: number): void {
    const pages = this.snap.pages;
    const slug = this.snap.activeSlug;
    if (!pages.length || !slug) return;
    const idx = pages.findIndex((p) => p.slug === slug);
    const next = idx + offset;
    if (next >= 0 && next < pages.length) {
      this.setState({ activeSlug: pages[next].slug });
    }
  }

  /** Load the active wiki page content with offline fallback. */
  async loadActivePage(): Promise<void> {
    const repo = this.snap.repository;
    const slug = this.snap.activeSlug;
    if (!repo || !slug) return;
    this.setState({ pageLoading: true });
    try {
      let page: WikiPageDetail;
      try {
        page = await firstValueFrom(this.api.getWikiPage(repo.id, slug));
        await this.offlineCache.setPage(repo.id, slug, page as any);
      } catch (netErr) {
        const cached = await this.offlineCache.getPage(repo.id, slug);
        if (cached) {
          page = cached as any;
        } else {
          throw netErr;
        }
      }
      this.setState({ activePage: page, pageLoading: false });
    } catch {
      this.setState({ pageLoading: false });
    }
  }

  /** Load wiki structure by repo ID and set as active (without navigation). */
  async loadWiki(repoId: number): Promise<void> {
    try {
      const structure = await firstValueFrom(this.api.getWikiStructure(repoId));
      await this.offlineCache.setStructure(repoId, structure as any);
      this.setState({
        repository: structure.repository,
        pages: structure.pages,
        activeSlug: structure.pages[0]?.slug || null,
        activePage: null,
        pageLoading: false,
      });
    } catch (err) {
      const cached = await this.offlineCache.getStructure(repoId);
      if (cached) {
        const structure = cached as any as WikiStructureResponse;
        this.setState({
          repository: structure.repository,
          pages: structure.pages,
          activeSlug: structure.pages[0]?.slug || null,
          activePage: null,
          pageLoading: false,
        });
      } else {
        this.setState({ pageLoading: false });
      }
    }
  }

  // --------------------------------------------------------------------------
  // Mutations
  // --------------------------------------------------------------------------

  async handleDeleteRepository(repoId: number): Promise<void> {
    await firstValueFrom(this.api.deleteRepository(repoId));
    await this.offlineCache.clearRepo(repoId);
    this.setState({
      repositories: this.snap.repositories.filter((r) => r.id !== repoId),
    });
  }

  handleReindexRepository(repo: RepositorySummary | null): void {
    this.setState({ reindexPrefill: repo, submitError: '' });
  }

  async handleConnect(payload: IndexRepositoryRequest): Promise<void> {
    this.setState({ isSubmitting: true, submitError: '' });
    try {
      const res = await firstValueFrom(this.api.indexRepository(payload));
      localStorage.setItem(STORAGE_JOB_ID, String(res.job_id));
      localStorage.setItem(STORAGE_JOB_PATH, payload.project_path);
      this.setState({
        activeJobId: res.job_id,
        projectPathLabel: payload.project_path,
        isSubmitting: false,
      });
      this.router.navigate(['/indexing', res.job_id]);
    } catch (err) {
      this.setState({
        submitError:
          (err instanceof Error ? err.message : String(err)) ||
          'No se pudo iniciar el indexado.',
        isSubmitting: false,
      });
    }
  }

  async onIndexComplete(repositoryId: number): Promise<void> {
    await this.offlineCache.clearRepo(repositoryId);
    const structure = await firstValueFrom(this.api.getWikiStructure(repositoryId));
    await this.offlineCache.setStructure(repositoryId, structure as any);
    this.setState({
      repository: structure.repository,
      pages: structure.pages,
      activeSlug: structure.pages[0]?.slug || null,
      activePage: null,
      pageLoading: false,
    });
    this.router.navigate(['/wiki', repositoryId]);
  }

  async handleUpdatePage(
    slug: string,
    newMarkdown: string,
    preloadedPage: WikiPageDetail | null = null,
  ): Promise<void> {
    const repo = this.snap.repository;
    if (!repo) return;
    const updated =
      preloadedPage ??
      (await firstValueFrom(this.api.updateWikiPage(repo.id, slug, newMarkdown)));
    await this.offlineCache.setPage(repo.id, slug, updated as any);
    this.setState({ activePage: updated });
  }

  async handleRegeneratePage(slug: string): Promise<void> {
    const repo = this.snap.repository;
    if (!repo) return;
    try {
      const updated = await firstValueFrom(this.api.regenerateWikiPage(repo.id, slug));
      await this.offlineCache.setPage(repo.id, slug, updated as any);
      this.setState({ activePage: updated });
    } catch (error: unknown) {
      const apiErr = error as { status?: number };
      if (apiErr.status !== 400) throw error;
      const token = window.prompt(
        'GitLab token para regenerar esta página (no se guardará):',
      ) || '';
      if (!token) return;
      const updated = await firstValueFrom(this.api.regenerateWikiPage(repo.id, slug, token));
      await this.offlineCache.setPage(repo.id, slug, updated as any);
      this.setState({ activePage: updated });
    }
  }

  // --------------------------------------------------------------------------
  // UI toggles
  // --------------------------------------------------------------------------

  setSearchOpen(v: boolean): void {
    this.setState({ searchOpen: v });
  }

  setGraphOpen(v: boolean): void {
    this.setState({ graphOpen: v });
  }

  setShortcutsOpen(v: boolean): void {
    this.setState({ shortcutsOpen: v });
  }

  setHistoryOpen(v: boolean): void {
    this.setState({ historyOpen: v });
  }

  setPaletteOpen(v: boolean): void {
    this.setState({ paletteOpen: v });
  }

  setActiveSlug(slug: string): void {
    this.setState({ activeSlug: slug });
  }

  setActivePage(page: WikiPageDetail | null): void {
    this.setState({ activePage: page });
  }

  toggleShortcutsOpen(): void {
    this.setState({ shortcutsOpen: !this.snap.shortcutsOpen });
  }

  togglePaletteOpen(): void {
    this.setState({ paletteOpen: !this.snap.paletteOpen });
  }

  // --------------------------------------------------------------------------
  // Reset
  // --------------------------------------------------------------------------

  /** Reset wiki-related state (keeps browse/list state intact). */
  resetWiki(): void {
    this.setState({
      repository: null,
      pages: [],
      activeSlug: null,
      activePage: null,
      pageLoading: false,
      searchOpen: false,
      graphOpen: false,
      shortcutsOpen: false,
      historyOpen: false,
      paletteOpen: false,
      reindexPrefill: null,
      submitError: '',
      isSubmitting: false,
      activeJobId: null,
      projectPathLabel: '',
    });
  }
}
