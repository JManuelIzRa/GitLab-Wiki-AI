import { Component, signal } from '@angular/core';
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
  ) {}

  handleOpenGroup(group: GroupSummary): void {
    this.groupService.openExistingGroup(group);
  }

  handleNewGroup(): void {
    this.groupService.handleReindexGroup(null);
  }

  handleDelete(event: Event, groupId: number): void {
    event.stopPropagation();
    if (this.deletingId() !== null) return;
    if (!window.confirm('¿Eliminar este grupo indexado? Los repositorios se conservar\u00e1n.')) return;
    this.deletingId.set(groupId);
    this.groupService.handleDeleteGroup(groupId);
    this.deletingId.set(null);
  }

  handleReindex(event: Event, group: GroupSummary): void {
    event.stopPropagation();
    this.groupService.handleReindexGroup(group);
  }
}
