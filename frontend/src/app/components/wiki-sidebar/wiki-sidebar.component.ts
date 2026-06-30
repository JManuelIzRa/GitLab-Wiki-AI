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
import { RouterLink } from '@angular/router';
import { ApiService, WikiTextSearchResult } from '../../services/api.service';
import { RepoService } from '../../services/repo.service';
import { ThemeService } from '../../services/theme.service';
import { RepoSettingsPanelComponent } from '../repo-settings-panel/repo-settings-panel.component';
import { AtlasBrandComponent } from '../atlas-brand/atlas-brand.component';
import { Subject, Subscription, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';

interface PageNav {
  slug: string;
  title: string;
  parent_slug: string | null;
}

interface FlatTreeNode {
  slug: string;
  title: string;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
}

function buildFlatTree(pages: PageNav[], collapsedSet: ReadonlySet<string>, depth = 0, parentSlug?: string): FlatTreeNode[] {
  const children = pages.filter((p) => {
    const ps = p.parent_slug || '';
    return parentSlug ? ps === parentSlug : !ps;
  }).sort((a, b) => {
    const aTitle = a.title.toLowerCase();
    const bTitle = b.title.toLowerCase();
    return aTitle < bTitle ? -1 : aTitle > bTitle ? 1 : 0;
  });

  const result: FlatTreeNode[] = [];
  for (const p of children) {
    const hasChildren = pages.some((other) => (other.parent_slug || '') === p.slug);
    const collapsed = collapsedSet.has(p.slug);
    result.push({
      slug: p.slug,
      title: p.title,
      depth,
      hasChildren,
      collapsed,
    });
    if (!collapsed && hasChildren) {
      result.push(...buildFlatTree(pages, collapsedSet, depth + 1, p.slug));
    }
  }
  return result;
}

function filterTree(nodes: FlatTreeNode[], q: string): FlatTreeNode[] {
  if (!q) return nodes;
  return nodes.filter((n) => n.title.toLowerCase().includes(q));
}

@Component({
  selector: 'app-wiki-sidebar',
  standalone: true,
  imports: [RouterLink, RepoSettingsPanelComponent, AtlasBrandComponent],
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
  themeService = inject(ThemeService);

  repository = this.repoService.repository;
  pages = this.repoService.pages;
  activeSlug = this.repoService.activeSlug;

  filter = signal('');
  collapsedNodes = signal<Set<string>>(new Set());
  showSettings = signal(false);
  wikiSearchResults = signal<WikiTextSearchResult[] | null>(null);
  wikiSearchLoading = signal(false);

  private searchSubject = new Subject<string>();
  private searchSub?: Subscription;
  private keydownHandler?: (e: KeyboardEvent) => void;

  readonly q = computed(() => this.filter().trim().toLowerCase());

  readonly flatTree = computed(() =>
    buildFlatTree(this.pages() as unknown as PageNav[], this.collapsedNodes())
  );

  readonly filteredTree = computed(() =>
    filterTree(this.flatTree(), this.q())
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
    if (value.trim().length >= 2) {
      this.searchSubject.next(value);
    } else {
      this.wikiSearchResults.set(null);
    }
  }

  onSelectPage(slug: string): void {
    this.repoService.setActiveSlug(slug);
    this.filter.set('');
  }

  toggleCollapse(slug: string): void {
    const s = new Set(this.collapsedNodes());
    if (s.has(slug)) {
      s.delete(slug);
    } else {
      s.add(slug);
    }
    this.collapsedNodes.set(s);
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
