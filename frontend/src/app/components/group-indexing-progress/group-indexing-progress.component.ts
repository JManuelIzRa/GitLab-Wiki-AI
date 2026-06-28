import { Component, OnInit, OnDestroy, signal, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, interval, switchMap, takeWhile } from 'rxjs';
import { ApiService, type GroupJobResponse } from '../../services/api.service';
import { GroupService } from '../../services/group.service';

@Component({
  selector: 'app-group-indexing-progress',
  standalone: true,
  imports: [],
  templateUrl: './group-indexing-progress.component.html',
  styleUrls: ['./group-indexing-progress.component.css'],
})
export class GroupIndexingProgressComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private api = inject(ApiService);
  private groupService = inject(GroupService);

  job = signal<GroupJobResponse | null>(null);
  loading = signal(true);

  private pollingSub: Subscription | null = null;

  get total(): number {
    return Math.max(this.job()?.total_repos ?? 0, 1);
  }

  get done(): number {
    const j = this.job();
    return (j?.completed_repos ?? 0) + (j?.failed_repos ?? 0);
  }

  get pct(): number {
    return Math.min(Math.round((this.done / this.total) * 100), 100);
  }

  get isFailed(): boolean {
    return this.job()?.status === 'failed';
  }

  statusColor(status: string): string {
    switch (status) {
      case 'done':
        return 'var(--accent-sage)';
      case 'failed':
        return 'var(--accent-red)';
      case 'indexing':
        return 'var(--accent-rust)';
      default:
        return 'var(--text-tertiary)';
    }
  }

  ngOnInit(): void {
    const groupId = Number(this.route.snapshot.paramMap.get('groupId'));
    const jobId = Number(this.route.snapshot.paramMap.get('jobId'));

    if (!groupId || !jobId) {
      this.router.navigate(['/browse']);
      return;
    }

    // Initial fetch
    this.api.getGroupJob(groupId, jobId).subscribe({
      next: (initial) => {
        this.job.set(initial);
        this.loading.set(false);
        if (this.isTerminal(initial.status)) {
          this.handleDone(initial);
          return;
        }
        this.startPolling(groupId, jobId);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  private startPolling(groupId: number, jobId: number): void {
    this.pollingSub = interval(1500)
      .pipe(
        switchMap(() => this.api.getGroupJob(groupId, jobId)),
        takeWhile((j) => !this.isTerminal(j.status), true),
      )
      .subscribe({
        next: (updated) => {
          this.job.set(updated);
          if (this.isTerminal(updated.status)) {
            this.handleDone(updated);
          }
        },
        error: () => {
          /* polling continues silently */
        },
      });
  }

  private isTerminal(status: string): boolean {
    return status === 'done' || status === 'failed';
  }

  private handleDone(job: GroupJobResponse): void {
    this.groupService.onGroupJobDone(job);
  }

  ngOnDestroy(): void {
    this.pollingSub?.unsubscribe();
  }
}
