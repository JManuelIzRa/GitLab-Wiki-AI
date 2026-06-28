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

  // ---- Local UI state ----
  mobileNavOpen = signal(false);

  /** Safe repo name for templates (avoids `as any` casts). */
  repoName = computed(() => {
    const r = this.repoService.repository();
    return r?.name || r?.project_path || '';
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
    // Watch repoId route param changes → load wiki
    this.paramSub = this.route.paramMap.subscribe((params) => {
      const repoId = Number(params.get('repoId'));
      if (repoId) {
        this.repoService.loadWiki(repoId);
      }
    });

    // Watch activeSlug changes via effect → load page content
    this.loadEffect = effect(() => {
      // Access signals to register dependency
      void this.repoService.activeSlug();
      void this.repoService.repository();
      const repo = this.repoService.repository();
      if (repo) {
        this.repoService.loadActivePage();
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

    // Cmd/Ctrl+K — toggle command palette
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
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
  }
}
