import {
  Component,
  Input,
  Output,
  EventEmitter,
  signal,
  inject,
} from '@angular/core';
import { ApiService, PushToGitLabWikiResponse } from '../../services/api.service';

@Component({
  selector: 'app-push-to-gitlab-dialog',
  standalone: true,
  imports: [],
  templateUrl: './push-to-gitlab-dialog.component.html',
  styleUrls: ['./push-to-gitlab-dialog.component.css'],
})
export class PushToGitLabDialogComponent {
  @Input({ required: true }) repoId!: number;
  @Output() close = new EventEmitter<void>();

  private api = inject(ApiService);

  token = signal('');
  status = signal<PushToGitLabWikiResponse | null>(null);
  pushing = signal(false);
  error = signal('');

  async handlePush(): Promise<void> {
    const t = this.token().trim();
    if (!t) {
      this.error.set('Introduce un PAT con scope api o write_wiki.');
      return;
    }

    this.pushing.set(true);
    this.error.set('');
    try {
      const result = await this.api.pushToGitLabWiki(this.repoId, t).toPromise();
      this.status.set(result ?? null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al publicar en GitLab Wiki.';
      this.error.set(msg);
    } finally {
      this.pushing.set(false);
    }
  }
}
