import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  signal,
  computed,
  inject,
  ElementRef,
  ViewChild,
} from '@angular/core';
import { ApiService, WikiTextSearchResult } from '../../services/api.service';
import { RepoService } from '../../services/repo.service';
import { RepoSettingsPanelComponent } from '../repo-settings-panel/repo-settings-panel.component';
import { Subject, Subscription, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';

interface PageNav {
  slug: string;
  title: string;
  parent_slug: string | null;
}

function groupPages(pages: PageNav[]) {
  const root = pages.filter((p) => !p.parent_slug);
  const modules = pages.filter((p) => p.parent_slug === 'modules');
  return { root, modules };
}

@Component({
  selector: 'app-wiki-sidebar',
  standalone: true,
  imports: [RepoSettingsPanelComponent],
  templateUrl: './wiki-sidebar.component.html',
  styleUrls: ['./wiki-sidebar.component.css'],
})
export class WikiSidebarComponent implements OnInit, OnDestroy {
  @Input() mobileOpen = false;
  @Output() mobileClose = new EventEmitter<void>();
  @Output() reset = new EventEmitter<void>();
  @Output() reindex = new EventEmitter<void>();

  @ViewChild('searchInput') searchInputRef!: ElementRef<HTMLInputElement>;

  private api = inject(ApiService);
  repoService = inject(RepoService);

  repository = this.repoService.repository;
  pages = this.repoService.pages;
  activeSlug = this.repoService.activeSlug;

  filter = signal('');
  modulesCollapsed = signal(false);
  showSettings = signal(false);
  wikiSearchResults = signal<WikiTextSearchResult[] | null>(null);
  wikiSearchLoading = signal(false);

  private searchSubject = new Subject<string>();
  private searchSub?: Subscription;
  private keydownHandler?: (e: KeyboardEvent) => void;

  readonly q = computed(() => this.filter().trim().toLowerCase());

  readonly grouped = computed(() => groupPages(this.pages() as unknown as PageNav[]));

  readonly filterPage = (p: PageNav) => !this.q() || p.title.toLowerCase().includes(this.q());

  readonly filteredRoot = computed(() =>
    this.grouped().root.filter(this.filterPage)
  );

  readonly filteredModules = computed(() =>
    this.grouped().modules.filter(this.filterPage)
  );

  readonly displayedResults = computed(() =>
    this.q().length >= 2 ? this.wikiSearchResults() : null
  );

  readonly displayedLoading = computed(() =>
    this.q().length >= 2 && this.wikiSearchLoading()
  );

  readonly lastIndexed = computed(() => {
    const repo = this.repository() as Record<string, unknown> | null;
    const updatedAt = repo?.['updated_at'];
    if (!updatedAt) return null;
    const d = new Date(updatedAt as string);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    } as Intl.DateTimeFormatOptions) + ', ' + d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    } as Intl.DateTimeFormatOptions);
  });

  readonly exportUrl = computed(() => {
    const repo = this.repository() as Record<string, unknown> | null;
    return repo ? this.api.getExportUrl(repo['id'] as number) : '';
  });

  readonly htmlExportUrl = computed(() => {
    const repo = this.repository() as Record<string, unknown> | null;
    return repo ? this.api.getHtmlExportUrl(repo['id'] as number) : '';
  });

  ngOnInit(): void {
    // Debounced wiki text search
    this.searchSub = this.searchSubject.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      switchMap(async (q) => {
        if (q.length < 2) return;
        this.wikiSearchLoading.set(true);
        this.wikiSearchResults.set(null);
        const repo = this.repository() as Record<string, unknown> | null;
        if (!repo) return;
        try {
          const results = await this.api.searchWikiText(repo['id'] as number, q).toPromise();
          this.wikiSearchResults.set(results ?? []);
        } catch {
          this.wikiSearchResults.set([]);
        } finally {
          this.wikiSearchLoading.set(false);
        }
      }),
    ).subscribe();

    // Keyboard shortcut: / to focus search, Escape to clear
    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        this.searchInputRef?.nativeElement?.focus();
      }
      if (e.key === 'Escape' && document.activeElement === this.searchInputRef?.nativeElement) {
        this.filter.set('');
        this.searchInputRef?.nativeElement?.blur();
      }
    };
    document.addEventListener('keydown', this.keydownHandler);
  }

  ngOnDestroy(): void {
    this.searchSub?.unsubscribe();
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
    }
  }

  onFilterChange(value: string): void {
    this.filter.set(value);
    this.searchSubject.next(value);
  }

  onSelectPage(slug: string): void {
    this.repoService.setActiveSlug(slug);
    this.filter.set('');
  }

  onClose(): void {
    this.mobileClose.emit();
  }

  onReset(): void {
    this.reset.emit();
  }

  onReindex(): void {
    this.reindex.emit();
  }

  printPage(): void {
    window.print();
  }
}
