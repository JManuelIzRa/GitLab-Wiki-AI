import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  inject,
  ElementRef,
  ViewChild,
  AfterViewChecked,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, finalize } from 'rxjs';
import { ApiService, type CrossRepoSearchResponse, type StreamEvent } from '../../services/api.service';
import { GroupService } from '../../services/group.service';
import { RepoService } from '../../services/repo.service';

@Component({
  selector: 'app-group-wiki-view',
  standalone: true,
  imports: [],
  templateUrl: './group-wiki-view.component.html',
  styleUrls: ['./group-wiki-view.component.css'],
})
export class GroupWikiViewComponent implements OnInit, OnDestroy, AfterViewChecked {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private api = inject(ApiService);
  private repoService = inject(RepoService);
  private sanitizer = inject(DomSanitizer);
  groupService = inject(GroupService);

  // ---- Group ----
  group = this.groupService.activeGroup;

  // ---- Tab state ----
  activeTab = signal<'overview' | 'repos' | 'search' | 'chat'>('overview');

  // ---- Search ----
  searchQuery = signal('');
  searchResults = signal<CrossRepoSearchResponse['results'] | null>(null);
  isSearching = signal(false);

  // ---- Chat ----
  chatInput = signal('');
  chatHistory = signal<
    Array<{ role: string; content: string; sources?: unknown[] }>
  >([]);
  isChatStreaming = signal(false);

  @ViewChild('chatEnd') chatEndRef!: ElementRef;

  private paramSub: Subscription | null = null;
  private chatSub: Subscription | null = null;

  ngOnInit(): void {
    this.paramSub = this.route.paramMap.subscribe((params) => {
      const groupId = Number(params.get('groupId'));
      if (groupId) {
        this.groupService.loadGroup(groupId);
      }
    });
  }

  ngAfterViewChecked(): void {
    this.scrollChatToBottom();
  }

  ngOnDestroy(): void {
    this.paramSub?.unsubscribe();
    this.chatSub?.unsubscribe();
  }

  private scrollChatToBottom(): void {
    try {
      this.chatEndRef?.nativeElement?.scrollIntoView({ behavior: 'smooth' });
    } catch {
      // ignore
    }
  }

  // ---- Tab navigation ----
  private tabFromString(tab: string): 'overview' | 'repos' | 'search' | 'chat' {
    if (tab === 'overview' || tab === 'repos' || tab === 'search' || tab === 'chat') return tab;
    return 'overview';
  }

  setActiveTab(tab: string): void {
    this.activeTab.set(this.tabFromString(tab));
  }

  // ---- Reset ----
  handleReset(): void {
    localStorage.removeItem('activeJobId');
    localStorage.removeItem('activeJobPath');
    this.repoService.resetWiki();
    this.groupService.resetGroup();
    this.router.navigate(['/browse']);
  }

  // ---- Open repo ----
  handleOpenRepo(repo: { id: number; name: string; project_path: string }): void {
    this.repoService.loadWiki(repo.id);
    this.router.navigate(['/wiki', repo.id]);
  }

  // ---- Cross-repo search ----
  handleSearch(): void {
    const q = this.searchQuery()?.trim();
    const group = this.group();
    if (!q || !group || this.isSearching()) return;

    this.isSearching.set(true);
    this.searchResults.set(null);

    this.api.crossRepoSearch(group.id, q).subscribe({
      next: (res) => {
        this.searchResults.set(res.results || []);
        this.isSearching.set(false);
      },
      error: () => {
        this.searchResults.set([]);
        this.isSearching.set(false);
      },
    });
  }

  // ---- Chat ----
  handleChat(): void {
    const question = this.chatInput()?.trim();
    const group = this.group();
    if (!question || !group || this.isChatStreaming()) return;

    this.chatInput.set('');
    this.chatHistory.update((prev) => [...prev, { role: 'user', content: question }]);
    this.isChatStreaming.set(true);

    let accumulated = '';
    this.chatHistory.update((prev) => [
      ...prev,
      { role: 'assistant', content: '', sources: [] },
    ]);

    this.chatSub = this.api
      .streamGroupChat(group.id, question)
      .pipe(finalize(() => this.isChatStreaming.set(false)))
      .subscribe({
        next: (event: StreamEvent) => {
          if (event.token !== undefined) {
            accumulated += event.token;
            this.chatHistory.update((prev) => {
              const copy = [...prev];
              copy[copy.length - 1] = {
                ...copy[copy.length - 1],
                content: accumulated,
              };
              return copy;
            });
          } else if (event.sources !== undefined) {
            this.chatHistory.update((prev) => {
              const copy = [...prev];
              copy[copy.length - 1] = {
                ...copy[copy.length - 1],
                sources: event.sources as unknown[],
              };
              return copy;
            });
          }
        },
        error: () => {
          this.chatHistory.update((prev) => [
            ...prev,
            { role: 'error', content: 'Error al obtener respuesta.' },
          ]);
        },
      });
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
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');

    html = '<p>' + html + '</p>';
    html = html.replace(/<p>\s*<\/p>/g, '');
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }
}
