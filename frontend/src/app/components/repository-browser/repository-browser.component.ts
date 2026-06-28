import { Component, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { RepoService } from '../../services/repo.service';
import { GroupService } from '../../services/group.service';
import { GroupBrowserComponent } from '../group-browser/group-browser.component';
import type { RepositorySummary } from '../../services/api.service';

@Component({
  selector: 'app-repository-browser',
  imports: [GroupBrowserComponent],
  templateUrl: './repository-browser.component.html',
  styleUrls: ['./repository-browser.component.css'],
  standalone: true,
})
export class RepositoryBrowserComponent implements OnInit {
  tab = signal<'repos' | 'groups'>('repos');
  deletingId = signal<number | null>(null);

  constructor(
    public repoService: RepoService,
    public groupService: GroupService,
    public router: Router,
  ) {}

  ngOnInit(): void {
    this.repoService.loadRepositories();
    this.groupService.loadGroups();
  }

  handleOpen(repo: RepositorySummary): void {
    this.repoService.openExistingRepository(repo);
  }

  handleDelete(event: Event, repoId: number): void {
    event.stopPropagation();
    if (this.deletingId() !== null) return;
    if (!window.confirm('¿Eliminar este repositorio indexado y su wiki local?')) return;
    this.deletingId.set(repoId);
    this.repoService.handleDeleteRepository(repoId);
    this.deletingId.set(null);
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

  reloadPage(): void {
    window.location.reload();
  }
}
