import { Component, OnInit, OnDestroy, signal, computed, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, interval, switchMap, takeWhile } from 'rxjs';
import { ApiService, type IndexJobResponse } from '../../services/api.service';
import { RepoService } from '../../services/repo.service';

export interface StageDef {
  key: string;
  label: string;
}

const STAGES: StageDef[] = [
  { key: 'pending', label: 'en cola' },
  { key: 'cloning', label: 'conectando con gitlab' },
  { key: 'analyzing', label: 'analizando estructura' },
  { key: 'generating', label: 'generando páginas con ia' },
  { key: 'embedding', label: 'indexando código en qdrant' },
  { key: 'done', label: 'listo' },
];

function stageIndex(status: string): number {
  const idx = STAGES.findIndex((s) => s.key === status);
  return idx === -1 ? 0 : idx;
}

@Component({
  selector: 'app-indexing-progress',
  standalone: true,
  imports: [],
  templateUrl: './indexing-progress.component.html',
  styleUrls: ['./indexing-progress.component.css'],
})
export class IndexingProgressComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private api = inject(ApiService);
  private repoService = inject(RepoService);

  readonly stages = STAGES;

  job = signal<IndexJobResponse | null>(null);
  projectPath = signal('');

  private pollingSub: Subscription | null = null;

  /** Derived status: the current stage key or 'pending'. */
  get status(): string {
    return this.job()?.status ?? 'pending';
  }

  get isFailed(): boolean {
    return this.status === 'failed';
  }

  get currentIdx(): number {
    return stageIndex(this.status);
  }

  stageState(idx: number): 'pending' | 'active' | 'done' | 'failed' {
    if (this.isFailed && idx === this.currentIdx) return 'failed';
    if (idx < this.currentIdx) return 'done';
    if (idx === this.currentIdx) return 'active';
    return 'pending';
  }

  ngOnInit(): void {
    const jobId = Number(this.route.snapshot.paramMap.get('jobId'));
    if (!jobId) {
      this.router.navigate(['/browse']);
      return;
    }

    this.projectPath.set(localStorage.getItem('activeJobPath') || '');

    // Poll every 1.5s until terminal
    this.pollingSub = interval(1500)
      .pipe(
        switchMap(() => this.api.getJobStatus(jobId)),
        takeWhile(
          (j) => j.status !== 'done' && j.status !== 'failed',
          true, // include the terminal value
        ),
      )
      .subscribe({
        next: (j) => {
          this.job.set(j);
          if (j.status === 'done' || j.status === 'failed') {
            localStorage.removeItem('activeJobId');
            localStorage.removeItem('activeJobPath');
          }
          if (j.status === 'done' && j.repository_id) {
            this.repoService.onIndexComplete(j.repository_id);
          }
        },
        error: () => {
          this.job.set({
            job_id: jobId,
            repository_id: 0,
            status: 'failed',
            progress: 0,
            current_step: '',
            error_message: 'Error al conectar con el servidor.',
            created_at: null,
            finished_at: null,
          });
        },
      });
  }

  ngOnDestroy(): void {
    this.pollingSub?.unsubscribe();
  }
}
