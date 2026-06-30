import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
  inject,
  HostListener,
  effect,
  EffectRef,
} from '@angular/core';
import { ThemeService } from '../../services/theme.service';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { RepoService } from '../../services/repo.service';
import { WikiSidebarComponent } from '../wiki-sidebar/wiki-sidebar.component';
import { WikiPageContentComponent } from '../wiki-page-content/wiki-page-content.component';
import { AskPanelComponent } from '../ask-panel/ask-panel.component';
import { CodeSearchComponent } from '../code-search/code-search.component';
import { DependencyGraphViewComponent } from '../dependency-graph-view/dependency-graph-view.component';
import { JobHistoryPanelComponent } from '../job-history-panel/job-history-panel.component';
import { KeyboardShortcutsModalComponent } from '../keyboard-shortcuts-modal/keyboard-shortcuts-modal.component';
import { CommandPaletteComponent, CommandPaletteAction } from '../command-palette/command-palette.component';

@Component({
  selector: 'app-wiki-layout',
  standalone: true,
  imports: [
    WikiSidebarComponent,
    WikiPageContentComponent,
    AskPanelComponent,
    CodeSearchComponent,
    DependencyGraphViewComponent,
    JobHistoryPanelComponent,
    KeyboardShortcutsModalComponent,
    CommandPaletteComponent,
  ],
  templateUrl: './wiki-layout.component.html',
  styleUrls: ['./wiki-layout.component.css'],
})
export class WikiLayoutComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  repoService = inject(RepoService);
  private themeService = inject(ThemeService);

  // ---- Local UI state ----
  mobileNavOpen = signal(false);

  /** Safe repo name for templates (avoids `as any` casts). */
  repoName = computed(() => {
    const r = this.repoService.repository();
    return r?.name || r?.project_path || '';
  });

  breadcrumbs = computed(() => {
    const page = this.activePage();
    const crumbs: Array<{ label: string; slug: string | null }> = [
      { label: 'Inicio', slug: null },
    ];
    if (this.repoName()) {
      crumbs.push({ label: this.repoName(), slug: null });
    }
    if (page) {
      const p = page as { slug: string; title: string; parent_slug?: string };
      crumbs.push({ label: p.title, slug: p.slug });
    }
    return crumbs;
  });

  // ---- Derived from RepoService signals ----
  repository = this.repoService.repository;
  pages = this.repoService.pages;
  activeSlug = this.repoService.activeSlug;
  activePage = this.repoService.activePage;
  pageLoading = this.repoService.pageLoading;
  searchOpen = this.repoService.searchOpen;
  graphOpen = this.repoService.graphOpen;
  shortcutsOpen = this.repoService.shortcutsOpen;
  historyOpen = this.repoService.historyOpen;
  paletteOpen = this.repoService.paletteOpen;

  private paramSub: Subscription | null = null;
  private loadEffect: EffectRef | null = null;

  readonly paletteActions: CommandPaletteAction[] = [
    {
      id: 'code-search',
      label: 'Buscar en el código',
      hint: 'acción',
      run: () => this.repoService.setSearchOpen(true),
    },
    {
      id: 'graph',
      label: 'Ver grafo de dependencias',
      hint: 'acción',
      run: () => this.repoService.setGraphOpen(true),
    },
    {
      id: 'history',
      label: 'Historial de indexado',
      hint: 'acción',
      run: () => this.repoService.setHistoryOpen(true),
    },
    {
      id: 'print',
      label: 'Imprimir / guardar como PDF',
      hint: 'acción',
      run: () => window.print(),
    },
  ];

  ngOnInit(): void {
    // Route params are the source of truth for refreshes and browser back/forward.
    this.paramSub = this.route.paramMap.subscribe((params) => {
      const repoId = Number(params.get('repoId'));
      const slug = params.get('slug');
      if (repoId) {
        const currentRepo = this.repoService.repository();
        const pages = this.repoService.pages();
        if (currentRepo?.id === repoId && pages.length > 0) {
          if (slug && pages.some((page) => page.slug === slug)) {
            this.repoService.setActiveSlug(slug);
          }
          return;
        }
        void this.repoService.loadWiki(repoId, slug);
      }
    });

    // Keep page content and the shareable URL synchronized with service state.
    this.loadEffect = effect(() => {
      const repo = this.repoService.repository();
      const slug = this.repoService.activeSlug();
      if (repo && slug) {
        const routeSlug = this.route.snapshot.paramMap.get('slug');
        if (routeSlug !== slug) {
          void this.router.navigate(['/wiki', repo.id, slug], {
            replaceUrl: !routeSlug,
          });
        }
        void this.repoService.loadActivePage();
      }
    });
  }

  ngOnDestroy(): void {
    this.paramSub?.unsubscribe();
    this.loadEffect = null;
  }

  /** Select a page from the sidebar (closes mobile nav). */
  onPageClick(slug: string): void {
    this.repoService.setActiveSlug(slug);
    this.mobileNavOpen.set(false);
  }

  /** React handleReset: wipe state and navigate to browse. */
  handleReset(): void {
    localStorage.removeItem('activeJobId');
    localStorage.removeItem('activeJobPath');
    this.repoService.resetWiki();
    this.router.navigate(['/browse']);
  }

  /** React handleReindex: navigate to connect with reindex prefill. */
  handleReindex(): void {
    const repo = this.repoService.repository();
    if (repo) {
      this.router.navigate(['/connect', (repo as { id: number }).id]);
    }
  }

  // ---- Keyboard navigation (ported from useWikiKeyboardNav) ----
  @HostListener('document:keydown', ['$event'])
  handleKeyboardNav(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') return;

    // ? — toggle shortcuts modal
    if (e.key === '?' && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      this.repoService.toggleShortcutsOpen();
      return;
    }

    // Cmd/Ctrl+K — toggle command palette (search overlay)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      this.repoService.togglePaletteOpen();
      return;
    }

    // Cmd/Ctrl+P — same command palette (VS Code muscle memory)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      this.repoService.togglePaletteOpen();
      return;
    }

    // Alt+ArrowLeft — previous page
    if (e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      this.repoService.navigatePage(-1);
      return;
    }

    // Alt+ArrowRight — next page
    if (e.altKey && e.key === 'ArrowRight') {
      e.preventDefault();
      this.repoService.navigatePage(1);
      return;
    }

    // Escape — close the topmost open panel
    if (e.key === 'Escape' && !e.altKey && !e.ctrlKey && !e.metaKey) {
      if (this.paletteOpen()) {
        this.repoService.setPaletteOpen(false);
        return;
      }
      if (this.shortcutsOpen()) {
        this.repoService.setShortcutsOpen(false);
        return;
      }
      if (this.searchOpen()) {
        this.repoService.setSearchOpen(false);
        return;
      }
      if (this.graphOpen()) {
        this.repoService.setGraphOpen(false);
        return;
      }
      if (this.historyOpen()) {
        this.repoService.setHistoryOpen(false);
        return;
      }
    }

    // T — toggle theme
    if (e.key === 't' && !e.altKey && !e.ctrlKey && !e.metaKey && tag !== 'INPUT') {
      e.preventDefault();
      this.themeService.toggleTheme();
      return;
    }
  }
}
