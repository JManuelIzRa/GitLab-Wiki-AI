import { DatePipe } from '@angular/common';
import {
  Component,
  Input,
  Output,
  EventEmitter,
  signal,
  inject,
} from '@angular/core';
import { ApiService, WikiRevisionResponse } from '../../services/api.service';

function computeLineDiff(aText: string, bText: string): { type: string; line: string }[] {
  const aLines = aText.split('\n');
  const bLines = bText.split('\n');
  const m = aLines.length;
  const n = bLines.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        aLines[i - 1] === bLines[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  let i = m;
  let j = n;
  const ops: { type: string; line: string }[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aLines[i - 1] === bLines[j - 1]) {
      ops.push({ type: 'eq', line: aLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'add', line: bLines[j - 1] });
      j--;
    } else {
      ops.push({ type: 'del', line: aLines[i - 1] });
      i--;
    }
  }
  return ops.reverse();
}

@Component({
  selector: 'app-revision-panel',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './revision-panel.component.html',
  styleUrls: ['./revision-panel.component.css'],
})
export class RevisionPanelComponent {
  @Input({ required: true }) repoId!: number;
  @Input({ required: true }) slug!: string;
  @Input({ required: true }) currentContent!: string;
  @Output() restore = new EventEmitter<unknown>();
  @Output() close = new EventEmitter<void>();

  private api = inject(ApiService);

  revisions = signal<WikiRevisionResponse[]>([]);
  loading = signal(true);
  error = signal('');
  restoring = signal<number | null>(null);
  diffRev = signal<WikiRevisionResponse | null>(null);

  constructor() {
    this.loadRevisions();
  }

  private loadRevisions(): void {
    this.api.getWikiRevisions(this.repoId, this.slug).subscribe({
      next: (data) => {
        this.revisions.set(data);
        this.loading.set(false);
      },
      error: (err: Error) => {
        this.error.set(err.message);
        this.loading.set(false);
      },
    });
  }

  async handleRestore(rev: WikiRevisionResponse): Promise<void> {
    this.restoring.set(rev.id);
    try {
      const restored = await this.api
        .restoreWikiRevision(this.repoId, this.slug, rev.id)
        .toPromise();
      this.restore.emit(restored);
      this.close.emit();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'No se pudo restaurar.';
      this.error.set(msg);
      this.restoring.set(null);
    }
  }

  showDiff(rev: WikiRevisionResponse): void {
    this.diffRev.set(rev);
  }

  closeDiff(): void {
    this.diffRev.set(null);
  }

  computeDiff(currentContent: string, revisionContent: string) {
    const ops = computeLineDiff(revisionContent, currentContent);
    const added = ops.filter((o) => o.type === 'add').length;
    const deleted = ops.filter((o) => o.type === 'del').length;
    return { ops, added, deleted };
  }
}
