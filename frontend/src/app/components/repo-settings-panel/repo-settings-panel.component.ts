import {
  Component,
  Output,
  EventEmitter,
  signal,
  inject,
} from '@angular/core';
import { ApiService } from '../../services/api.service';
import { RepoService } from '../../services/repo.service';

@Component({
  selector: 'app-repo-settings-panel',
  standalone: true,
  imports: [],
  templateUrl: './repo-settings-panel.component.html',
  styleUrls: ['./repo-settings-panel.component.css'],
})
export class RepoSettingsPanelComponent {
  @Output() close = new EventEmitter<void>();

  private api = inject(ApiService);
  private repoService = inject(RepoService);

  repository = this.repoService.repository;

  systemPrompt = signal('');
  gitlabToken = signal('');
  wikiLanguage = signal('');
  promptOverridesRaw = signal('');
  promptOverridesError = signal('');
  saving = signal(false);
  saved = signal(false);
  error = signal('');

  constructor() {
    const repo = this.repository() as Record<string, unknown> | null;
    if (repo) {
      this.systemPrompt.set((repo['system_prompt'] as string) || '');
      this.wikiLanguage.set((repo['wiki_language'] as string) || '');
      const overrides = repo['prompt_overrides'];
      this.promptOverridesRaw.set(
        overrides ? JSON.stringify(overrides, null, 2) : ''
      );
    }
  }

  async handleSave(): Promise<void> {
    this.promptOverridesError.set('');
    let parsedOverrides: Record<string, string> | null = null;
    const raw = this.promptOverridesRaw().trim();
    if (raw) {
      try {
        parsedOverrides = JSON.parse(raw);
      } catch {
        this.promptOverridesError.set('JSON inválido en los overrides de prompt.');
        return;
      }
    }

    const repo = this.repository() as { id: number } | null;
    if (!repo) return;

    this.saving.set(true);
    this.error.set('');
    try {
      const promises: Promise<unknown>[] = [
        this.api.setSystemPrompt(repo.id, this.systemPrompt()).toPromise(),
        this.api.setWikiLanguage(repo.id, this.wikiLanguage()).toPromise(),
        this.api.setPromptOverrides(repo.id, parsedOverrides).toPromise(),
      ];
      const token = this.gitlabToken().trim();
      if (token) {
        promises.push(this.api.setGitLabToken(repo.id, token).toPromise());
      }
      await Promise.all(promises);
      this.saved.set(true);
      setTimeout(() => this.saved.set(false), 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al guardar.';
      this.error.set(msg);
    } finally {
      this.saving.set(false);
    }
  }
}
