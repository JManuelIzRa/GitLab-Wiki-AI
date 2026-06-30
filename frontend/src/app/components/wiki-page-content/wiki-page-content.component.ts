import {
  Component,
  computed,
  signal,
  inject,
  OnDestroy,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { RepoService } from '../../services/repo.service';
import { ApiService } from '../../services/api.service';
import { gitLabSourceUrl } from '../../utils/gitlab-url';
import { HighlightedCodeComponent } from '../highlighted-code/highlighted-code.component';
import { MermaidDiagramComponent } from '../mermaid-diagram/mermaid-diagram.component';
import { RevisionPanelComponent } from '../revision-panel/revision-panel.component';
import { PushToGitLabDialogComponent } from '../revision-panel/push-to-gitlab-dialog.component';

interface MarkdownBlock {
  type: 'mermaid' | 'code' | 'html' | 'empty';
  content: string;
  lang?: string;
}

@Component({
  selector: 'app-wiki-page-content',
  standalone: true,
  imports: [
    HighlightedCodeComponent,
    MermaidDiagramComponent,
    RevisionPanelComponent,
    PushToGitLabDialogComponent,
  ],
  templateUrl: './wiki-page-content.component.html',
  styleUrls: ['./wiki-page-content.component.css'],
})
export class WikiPageContentComponent implements OnDestroy {
  repoService = inject(RepoService);
  private api = inject(ApiService);
  private sanitizer = inject(DomSanitizer);

  page = this.repoService.activePage;
  repository = this.repoService.repository;

  isEditing = signal(false);
  editedContent = signal('');
  isSaving = signal(false);
  saveError = signal('');
  showRevisions = signal(false);
  showPushDialog = signal(false);
  toast = signal<string | null>(null);

  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private prevSlug: string | null = null;

  /** Split markdown content into renderable blocks (mermaid, code, HTML). */
  readonly blocks = computed(() => {
    const p = this.page();
    if (!p) return [];
    return this.splitBlocks((p as { content_markdown: string }).content_markdown || '');
  });

  constructor() {
    // Watch for slug changes
    const p = this.page();
    if (p) {
      this.prevSlug = (p as { slug: string }).slug;
    }
  }

  ngOnDestroy(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }

  onEditingChange(): void {
    const p = this.page();
    if (!p) return;
    const slug = (p as { slug: string }).slug;
    if (slug !== this.prevSlug) {
      this.prevSlug = slug;
      this.isEditing.set(false);
      this.editedContent.set('');
      this.saveError.set('');
      this.showRevisions.set(false);
      this.toast.set(null);
    }
  }

  /** Split markdown into mermaid blocks, code blocks, and HTML-rendered rest. */
  private splitBlocks(markdown: string): MarkdownBlock[] {
    const blocks: MarkdownBlock[] = [];
    const lines = markdown.split('\n');
    let i = 0;

    while (i < lines.length) {
      // Mermaid block
      if (lines[i].trim() === '```mermaid') {
        i++;
        const contentLines: string[] = [];
        while (i < lines.length && lines[i].trim() !== '```') {
          contentLines.push(lines[i]);
          i++;
        }
        i++;
        blocks.push({ type: 'mermaid', content: contentLines.join('\n') });
        continue;
      }

      // Code block
      const codeMatch = lines[i].match(/^```(\w*)/);
      if (codeMatch) {
        const lang = codeMatch[1] || 'text';
        i++;
        const contentLines: string[] = [];
        while (i < lines.length && lines[i].trim() !== '```') {
          contentLines.push(lines[i]);
          i++;
        }
        i++;
        blocks.push({ type: 'code', content: contentLines.join('\n'), lang });
        continue;
      }

      // Regular markdown lines
      const htmlLines: string[] = [];
      while (i < lines.length && !lines[i].match(/^```/)) {
        htmlLines.push(lines[i]);
        i++;
      }

      if (htmlLines.length > 0) {
        const text = htmlLines.join('\n').trim();
        if (text) {
          blocks.push({ type: 'html', content: text });
        }
      } else {
        blocks.push({ type: 'empty', content: '' });
      }
    }

    return blocks;
  }

  /** Convert markdown text to safe HTML */
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
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');

    html = '<p>' + html + '</p>';
    html = html.replace(/<p>\s*<\/p>/g, '');
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  handleEditStart(): void {
    const p = this.page() as { content_markdown: string } | null;
    if (!p) return;
    this.editedContent.set(p.content_markdown);
    this.saveError.set('');
    this.isEditing.set(true);
  }

  async handleSave(): Promise<void> {
    const repo = this.repository() as { id: number } | null;
    const p = this.page() as { slug: string } | null;
    if (!repo || !p) return;

    this.isSaving.set(true);
    this.saveError.set('');
    try {
      const result = await this.api
        .updateWikiPage(repo.id, p.slug, this.editedContent())
        .toPromise();
      this.repoService.setActivePage(result as any);
      this.isEditing.set(false);
      this.showToast('Guardado correctamente');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'No se pudo guardar la página.';
      this.saveError.set(msg);
    } finally {
      this.isSaving.set(false);
    }
  }

  handleCancel(): void {
    this.isEditing.set(false);
    this.editedContent.set('');
    this.saveError.set('');
  }

  handleRestored(restoredPage: unknown): void {
    this.repoService.setActivePage(restoredPage as any);
    this.showToast('Revisión restaurada');
  }

  private showToast(message: string): void {
    this.toast.set(message);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 2400);
  }

  async copyCode(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
    } catch { /* ignore */ }
  }

  gitLabSourceUrl(filePath: string): string | null {
    const repo = this.repository() as Record<string, unknown> | null;
    if (!repo) return null;
    return gitLabSourceUrl(repo as any, filePath);
  }
}
