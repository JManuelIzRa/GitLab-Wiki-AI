import { Component, OnInit, computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { RepoService } from '../../services/repo.service';
import { GroupService } from '../../services/group.service';
import { GroupBrowserComponent } from '../group-browser/group-browser.component';
import { AtlasBrandComponent } from '../atlas-brand/atlas-brand.component';
import type { RepositorySummary } from '../../services/api.service';

@Component({
  selector: 'app-repository-browser',
  imports: [GroupBrowserComponent, AtlasBrandComponent],
  templateUrl: './repository-browser.component.html',
  styleUrls: ['./repository-browser.component.css'],
  standalone: true,
})
export class RepositoryBrowserComponent implements OnInit {
  tab = signal<'repos' | 'groups'>('repos');
  deletingId = signal<number | null>(null);
  searchQuery = signal('');

  filteredRepositories = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const repos = this.repoService.repositories();
    if (!query) return repos;
    return repos.filter((repo) =>
      [repo.name, repo.project_path, repo.description, repo.default_branch]
        .some((value) => value?.toLowerCase().includes(query)),
    );
  });

  semanticRepositoryCount = computed(() =>
    this.repoService.repositories().filter((repo) => repo.indexed_in_qdrant).length,
  );

  constructor(
    public repoService: RepoService,
    public groupService: GroupService,
    public router: Router,
  ) {}

  ngOnInit(): void {
    this.repoService.loadRepositories();
    this.groupService.loadGroups();

    // First-launch auto-redirect to getting-started guide
    const dismissed = localStorage.getItem('atlas_onboarding_dismissed') === 'true';
    if (!dismissed) {
      // Check after repos load
      setTimeout(() => {
        if (this.repoService.repositories().length === 0) {
          this.router.navigate(['/getting-started']);
        }
      }, 100);
    }
  }

  handleOpen(repo: RepositorySummary): void {
    this.repoService.openExistingRepository(repo);
  }

  async handleDelete(event: Event, repoId: number): Promise<void> {
    event.stopPropagation();
    if (this.deletingId() !== null) return;
    if (!window.confirm('¿Eliminar este repositorio indexado y su wiki local?')) return;
    this.deletingId.set(repoId);
    try {
      await this.repoService.handleDeleteRepository(repoId);
    } catch {
      // The service exposes the actionable error in the dashboard.
    } finally {
      this.deletingId.set(null);
    }
  }

  handleReindex(event: Event, repo: RepositorySummary): void {
    event.stopPropagation();
    this.repoService.handleReindexRepository(repo);
    this.router.navigate(['/connect']);
  }

  handleNewRepo(): void {
    this.repoService.handleReindexRepository(null);
    this.router.navigate(['/connect']);
  }

  handleNewGroup(): void {
    this.groupService.handleReindexGroup(null);
    this.router.navigate(['/group/connect']);
  }

  loadMore(): void {
    this.repoService.loadMoreRepositories();
  }

  setTab(value: 'repos' | 'groups'): void {
    this.tab.set(value);
  }

  retryRepositories(): void {
    this.repoService.loadRepositories();
  }

  formatUpdatedAt(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'fecha desconocida';
    return new Intl.RelativeTimeFormat('es', { numeric: 'auto' }).format(
      Math.round((date.getTime() - Date.now()) / 86_400_000),
      'day',
    );
  }
}
