import {
  Component,
  Output,
  EventEmitter,
  signal,
  inject,
  ElementRef,
  ViewChild,
  AfterViewInit,
} from '@angular/core';
import { ApiService, CodeSource } from '../../services/api.service';
import { RepoService } from '../../services/repo.service';
import { languageFromPath } from '../../utils/language';
import { gitLabSourceUrl } from '../../utils/gitlab-url';
import { HighlightedCodeComponent } from '../highlighted-code/highlighted-code.component';

interface LineProps {
  style?: Record<string, string>;
}

@Component({
  selector: 'app-code-search',
  standalone: true,
  imports: [HighlightedCodeComponent],
  templateUrl: './code-search.component.html',
  styleUrls: ['./code-search.component.css'],
})
export class CodeSearchComponent implements AfterViewInit {
  @Output() close = new EventEmitter<void>();

  @ViewChild('searchInput') searchInputRef!: ElementRef<HTMLInputElement>;

  private api = inject(ApiService);
  private repoService = inject(RepoService);
  private trapRef!: HTMLElement;

  repository = this.repoService.repository;
  query = signal('');
  results = signal<CodeSource[] | null>(null);
  loading = signal(false);
  error = signal('');

  @ViewChild('trapEl') set trapEl(el: ElementRef<HTMLElement>) {
    if (el) {
      this.trapRef = el.nativeElement;
      this.trapFocus();
    }
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.searchInputRef?.nativeElement?.focus(), 50);
  }

  private trapFocus(): void {
    if (!this.trapRef) return;
    const focusable = this.trapRef.querySelectorAll<HTMLElement>(
      'button, input, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.close.emit();
        return;
      }
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    this.trapRef.addEventListener('keydown', handler);
  }

  get ragAvailable(): boolean {
    const repo = this.repository() as Record<string, unknown> | null;
    return !!repo?.['indexed_in_qdrant'];
  }

  async handleSearch(e: Event): Promise<void> {
    e.preventDefault();
    const q = this.query().trim();
    if (!q || this.loading()) return;

    const repo = this.repository() as { id: number } | null;
    if (!repo) return;

    this.loading.set(true);
    this.error.set('');
    try {
      const res = await this.api.searchCode(repo.id, q).toPromise();
      this.results.set(res?.results ?? []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'No se pudo completar la búsqueda.';
      this.error.set(msg);
      this.results.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  onOverlayClick(): void {
    this.close.emit();
  }

  onModalClick(e: MouseEvent): void {
    e.stopPropagation();
  }

  expanded = signal<Set<number>>(new Set());

  toggleExpand(index: number): void {
    const s = this.expanded();
    if (s.has(index)) {
      s.delete(index);
    } else {
      s.add(index);
    }
    this.expanded.set(new Set(s));
  }

  matchingLineNumbers(content: string, query: string, startLine: number): Set<number> {
    if (!query) return new Set();
    const lower = query.toLowerCase();
    const lines = content.split('\n');
    const matched = new Set<number>();
    lines.forEach((line, i) => {
      if (line.toLowerCase().includes(lower)) matched.add(startLine + i);
    });
    return matched;
  }

  linePropsFn(content: string, query: string, startLine: number) {
    const matched = this.matchingLineNumbers(content, query, startLine);
    return (lineNumber: number): LineProps =>
      matched.has(lineNumber)
        ? { style: { display: 'block', backgroundColor: 'rgba(255,210,0,0.12)', borderLeft: '2px solid rgba(255,210,0,0.5)' } }
        : { style: { display: 'block' } };
  }

  languageFromPath(path: string): string {
    return languageFromPath(path);
  }

  gitLabSourceUrl(filePath: string, startLine?: number, endLine?: number): string | null {
    const repo = this.repository() as Record<string, unknown> | null;
    if (!repo) return null;
    return gitLabSourceUrl(repo as any, filePath, startLine, endLine);
  }
}
