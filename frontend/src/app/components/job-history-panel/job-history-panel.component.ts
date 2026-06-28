import { DatePipe } from '@angular/common';
import {
  Component,
  Output,
  EventEmitter,
  signal,
  inject,
  AfterViewInit,
  ViewChild,
} from '@angular/core';
import { ApiService, IndexJobResponse } from '../../services/api.service';
import { RepoService } from '../../services/repo.service';
import { gitLabCommitUrl } from '../../utils/gitlab-url';

@Component({
  selector: 'app-job-history-panel',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './job-history-panel.component.html',
  styleUrls: ['./job-history-panel.component.css'],
})
export class JobHistoryPanelComponent implements AfterViewInit {
  @Output() close = new EventEmitter<void>();

  private api = inject(ApiService);
  private repoService = inject(RepoService);
  private trapRef!: HTMLElement;

  repository = this.repoService.repository;
  jobs = signal<IndexJobResponse[]>([]);
  loading = signal(true);
  error = signal('');
  freshness = signal<{ stale: boolean; remote_sha: string } | null>(null);
  checking = signal(false);

  @ViewChild('trapEl') set trapEl(el: any) {
    if (el) {
      this.trapRef = el.nativeElement;
      this.trapFocus();
    }
  }

  constructor() {
    this.loadJobs();
  }

  ngAfterViewInit(): void {
    this.trapFocus();
  }

  private loadJobs(): void {
    const repo = this.repository() as { id: number } | null;
    if (!repo) return;

    this.api.listRepositoryJobs(repo.id).subscribe({
      next: (jobs) => {
        this.jobs.set(jobs);
        this.loading.set(false);
      },
      error: (err: Error) => {
        this.error.set(err.message);
        this.loading.set(false);
      },
    });
  }

  async checkFreshness(): Promise<void> {
    const repo = this.repository() as { id: number } | null;
    if (!repo) return;

    this.checking.set(true);
    this.error.set('');
    try {
      const result: any = await this.api.checkRepositoryStaleness(repo.id).toPromise();
      this.freshness.set(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      this.error.set(msg);
    } finally {
      this.checking.set(false);
    }
  }

  onOverlayClick(): void {
    this.close.emit();
  }

  onModalClick(e: MouseEvent): void {
    e.stopPropagation();
  }

  gitLabCommitUrl(): string | null {
    const repo = this.repository() as Record<string, unknown> | null;
    if (!repo) return null;
    return gitLabCommitUrl(repo as any);
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
}
