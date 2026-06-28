import {
  Component,
  signal,
  inject,
  ElementRef,
  ViewChild,
  AfterViewChecked,
  OnDestroy,
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

  constructor() {
    const repo = this.repository();
    if (repo) {
      const r = repo as { id: number; indexed_in_qdrant?: boolean };
      this.repositoryId.set(r.id);
      this.ragAvailable.set(!!r.indexed_in_qdrant);
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

  onClose(): void {
    this.open.set(false);
  }

  onStop(): void {
    this.abortController?.abort();
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
          },
        });
    } catch {
      this.loading.set(false);
    }
  }

  onClear(): void {
    this.messages.set([]);
  }

  markdownToHtml(text: string): SafeHtml {
    let html = text
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
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  async copyText(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch { /* ignore */ }
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
