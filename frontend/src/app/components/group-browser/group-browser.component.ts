import { Component, signal } from '@angular/core';
import { Router } from '@angular/router';
import { GroupService } from '../../services/group.service';
import type { GroupSummary } from '../../services/api.service';

@Component({
  selector: 'app-group-browser',
  templateUrl: './group-browser.component.html',
  styleUrls: ['./group-browser.component.css'],
  standalone: true,
})
export class GroupBrowserComponent {
  deletingId = signal<number | null>(null);

  constructor(
    public groupService: GroupService,
    private router: Router,
  ) {}

  handleOpenGroup(group: GroupSummary): void {
    this.groupService.openExistingGroup(group);
  }

  handleNewGroup(): void {
    this.groupService.handleReindexGroup(null);
    this.router.navigate(['/group/connect']);
  }

  async handleDelete(event: Event, groupId: number): Promise<void> {
    event.stopPropagation();
    if (this.deletingId() !== null) return;
    if (!window.confirm('¿Eliminar este grupo indexado? Los repositorios se conservar\u00e1n.')) return;
    this.deletingId.set(groupId);
    try {
      await this.groupService.handleDeleteGroup(groupId);
    } catch {
      // The service exposes the actionable error in the dashboard.
    } finally {
      this.deletingId.set(null);
    }
  }

  handleReindex(event: Event, group: GroupSummary): void {
    event.stopPropagation();
    this.groupService.handleReindexGroup(group);
    this.router.navigate(['/group/connect']);
  }

  retryGroups(): void {
    this.groupService.loadGroups();
  }
}
