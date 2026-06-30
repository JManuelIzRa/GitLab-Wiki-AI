import {
  Component,
  signal,
  inject,
  ElementRef,
  ViewChild,
  AfterViewChecked,
  OnDestroy,
  HostListener,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import { ApiService, StreamEvent, CodeSource } from '../../services/api.service';
import { RepoService } from '../../services/repo.service';
import { gitLabSourceUrl } from '../../utils/gitlab-url';
import { languageFromPath } from '../../utils/language';
import { HighlightedCodeComponent } from '../highlighted-code/highlighted-code.component';

interface ChatMessage {
  role: 'user' | 'assistant' | 'error';
  text: string;
  sources?: CodeSource[];
  streaming?: boolean;
}

@Component({
  selector: 'app-ask-panel',
  standalone: true,
  imports: [HighlightedCodeComponent],
  templateUrl: './ask-panel.component.html',
  styleUrls: ['./ask-panel.component.css'],
})
export class AskPanelComponent implements AfterViewChecked, OnDestroy {
  @ViewChild('scrollContainer') scrollRef!: ElementRef<HTMLElement>;
  @ViewChild('inputEl') inputRef!: ElementRef<HTMLInputElement>;

  private api = inject(ApiService);
  private repoService = inject(RepoService);
  private sanitizer = inject(DomSanitizer);

  repository = this.repoService.repository;
  repositoryId = signal<number | undefined>(undefined);
  ragAvailable = signal(false);

  open = signal(false);
  question = signal('');
  messages = signal<ChatMessage[]>([]);
  loading = signal(false);

  private streamSub?: Subscription;
  private abortController?: AbortController;
  private readonly STORAGE_PREFIX = 'chat_history_';

  constructor() {
    const repo = this.repository();
    if (repo) {
      const r = repo as { id: number; indexed_in_qdrant?: boolean };
      this.repositoryId.set(r.id);
      this.ragAvailable.set(!!r.indexed_in_qdrant);
      // Restore persisted chat history
      const saved = this.loadHistory(r.id);
      if (saved.length > 0) {
        this.messages.set(saved);
      }
    }
  }

  private storageKey(repoId: number): string {
    return `${this.STORAGE_PREFIX}${repoId}`;
  }

  private loadHistory(repoId: number): ChatMessage[] {
    try {
      const raw = localStorage.getItem(this.storageKey(repoId));
      if (raw) {
        const parsed = JSON.parse(raw) as ChatMessage[];
        if (Array.isArray(parsed)) return parsed.slice(-50);
      }
    } catch {
      // ignore
    }
    return [];
  }

  private saveHistory(): void {
    const repoId = this.repositoryId();
    if (!repoId) return;
    try {
      const msgs = this.messages().slice(-50);
      localStorage.setItem(this.storageKey(repoId), JSON.stringify(msgs));
    } catch {
      /* localStorage unavailable */
    }
  }

  ngAfterViewChecked(): void {
    if (this.scrollRef) {
      this.scrollRef.nativeElement.scrollTop = this.scrollRef.nativeElement.scrollHeight;
    }
  }

  ngOnDestroy(): void {
    this.streamSub?.unsubscribe();
  }

  onOpen(): void {
    this.open.set(true);
    setTimeout(() => this.inputRef?.nativeElement?.focus(), 50);
  }

  @HostListener('document:keydown', ['$event'])
  handleGlobalKeys(e: KeyboardEvent): void {
    if (e.key === 'Escape' && this.open()) {
      this.open.set(false);
    }
  }

  onClose(): void {
    this.open.set(false);
  }

  onStop(): void {
    this.abortController?.abort();
  }

  /** Hard-coded follow-up suggestions shown when no messages exist. */
  readonly suggestions: string[] = [
    '¿cuál es la arquitectura del proyecto?',
    '¿cómo se ejecuta el proyecto?',
    '¿qué tecnologías usa?',
    '¿cómo se estructuran los módulos?',
  ];

  /** Insert a suggestion chip text into the input box (or send it directly). */
  useSuggestion(text: string): void {
    this.question.set(text);
  }

  handleInputKeydown(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (this.question().trim() && !this.loading()) {
        this.onAsk(e);
      }
    }
  }

  async onAsk(e: Event): Promise<void> {
    e.preventDefault();
    const q = this.question().trim();
    if (!q || this.loading()) return;

    const repoId = this.repositoryId();
    if (!repoId) return;

    this.question.set('');
    this.loading.set(true);

    this.messages.update((prev) => [
      ...prev,
      { role: 'user', text: q },
      { role: 'assistant', text: '', sources: [], streaming: true },
    ]);

    this.abortController = new AbortController();

    try {
      this.streamSub = this.api
        .streamAskQuestion(repoId, q, [])
        .subscribe({
          next: (event: StreamEvent) => {
            if (event.token !== undefined) {
              this.messages.update((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last?.streaming) {
                  copy[copy.length - 1] = { ...last, text: last.text + event.token };
                }
                return copy;
              });
            } else if (event.sources !== undefined) {
              this.messages.update((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last?.streaming) {
                  copy[copy.length - 1] = { ...last, sources: event.sources };
                }
                return copy;
              });
            }
          },
          error: (err: Error) => {
            this.messages.update((prev) => {
              const copy = [...prev];
              if (copy[copy.length - 1]?.streaming) {
                copy[copy.length - 1] = { role: 'error', text: err.message };
              } else {
                copy.push({ role: 'error', text: err.message });
              }
              return copy;
            });
            this.loading.set(false);
            this.saveHistory();
          },
          complete: () => {
            this.messages.update((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last?.streaming) {
                copy[copy.length - 1] = { ...last, streaming: false };
              }
              return copy;
            });
            this.loading.set(false);
            this.saveHistory();
          },
        });
    } catch {
      this.loading.set(false);
    }
  }

  onClear(): void {
    this.messages.set([]);
    const repoId = this.repositoryId();
    if (repoId) {
      try {
        localStorage.removeItem(this.storageKey(repoId));
      } catch {
        // ignore
      }
    }
  }

  markdownToHtml(text: string): SafeHtml {
    const blocks: string[] = [];
    const withoutCode = text.replace(
      /```(\w*)\n([\s\S]*?)```/g,
      (_, lang, code) => {
        const escaped = code
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        const langAttr = lang ? ` class="lang-${lang}"` : '';
        const html =
          `<div class="code-block-wrap"><button class="code-copy-btn" data-code="${encodeURIComponent(code)}" title="Copiar código">⎘</button>` +
          `<pre><code${langAttr}>${escaped}</code></pre></div>`;
        blocks.push(html);
        return `%%CODEBLOCK_${blocks.length - 1}%%`;
      },
    );

    let html = withoutCode
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
      )
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');

    html = '<p>' + html + '</p>';
    html = html.replace(/<p>\s*<\/p>/g, '');

    html = html.replace(/%%CODEBLOCK_(\d+)%%/g, (_, id) => blocks[Number(id)] ?? '');

    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  async copyText(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch { /* ignore */ }
  }

  handleMarkdownClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const btn = target.closest('.code-copy-btn') as HTMLElement | null;
    const d = btn?.dataset as Record<string, string> | undefined;
    if (d?.['code']) {
      e.preventDefault();
      e.stopPropagation();
      const code = decodeURIComponent(d['code']);
      navigator.clipboard.writeText(code).catch(() => {});
    }
  }

  sourceExpanded = signal<Set<string>>(new Set());

  toggleSource(key: string): void {
    const s = this.sourceExpanded();
    if (s.has(key)) {
      s.delete(key);
    } else {
      s.add(key);
    }
    this.sourceExpanded.set(new Set(s));
  }

  gitLabSourceUrl(filePath: string, startLine?: number, endLine?: number): string | null {
    const repo = this.repository() as Record<string, unknown> | null;
    if (!repo) return null;
    return gitLabSourceUrl(repo as any, filePath, startLine, endLine);
  }

  languageFromPath(path: string): string {
    return languageFromPath(path);
  }
}
