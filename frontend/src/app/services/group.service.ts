import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  ApiService,
  type GroupSummary,
  type GroupDetail,
  type GroupJobResponse,
  type IndexGroupRequest,
} from './api.service';
import { OfflineCacheService } from './offline-cache.service';
import { firstValueFrom } from 'rxjs';

interface GroupServiceState {
  groups: GroupSummary[];
  groupsLoading: boolean;
  groupsError: string;

  activeGroup: GroupDetail | null;
  activeGroupJobId: number | null;
  activeGroupId: number | null;
  reindexGroupPrefill: GroupSummary | null;

  groupSubmitError: string;
  isGroupSubmitting: boolean;
}

const initialState: GroupServiceState = {
  groups: [],
  groupsLoading: false,
  groupsError: '',

  activeGroup: null,
  activeGroupJobId: null,
  activeGroupId: null,
  reindexGroupPrefill: null,

  groupSubmitError: '',
  isGroupSubmitting: false,
};

@Injectable({ providedIn: 'root' })
export class GroupService {
  // ---- Readonly signals ----
  readonly groups = signal<GroupSummary[]>(initialState.groups).asReadonly();
  readonly groupsLoading = signal<boolean>(initialState.groupsLoading).asReadonly();
  readonly groupsError = signal<string>(initialState.groupsError).asReadonly();

  readonly activeGroup = signal<GroupDetail | null>(initialState.activeGroup).asReadonly();
  readonly activeGroupJobId = signal<number | null>(initialState.activeGroupJobId).asReadonly();
  readonly activeGroupId = signal<number | null>(initialState.activeGroupId).asReadonly();
  readonly reindexGroupPrefill = signal<GroupSummary | null>(initialState.reindexGroupPrefill).asReadonly();

  readonly groupSubmitError = signal<string>(initialState.groupSubmitError);
  readonly isGroupSubmitting = signal<boolean>(initialState.isGroupSubmitting).asReadonly();

  // ---- Private writable signals ----
  private _groups = signal<GroupSummary[]>(initialState.groups);
  private _groupsLoading = signal<boolean>(initialState.groupsLoading);
  private _groupsError = signal<string>(initialState.groupsError);

  private _activeGroup = signal<GroupDetail | null>(initialState.activeGroup);
  private _activeGroupJobId = signal<number | null>(initialState.activeGroupJobId);
  private _activeGroupId = signal<number | null>(initialState.activeGroupId);
  private _reindexGroupPrefill = signal<GroupSummary | null>(initialState.reindexGroupPrefill);

  private _groupSubmitError = signal<string>(initialState.groupSubmitError);
  private _isGroupSubmitting = signal<boolean>(initialState.isGroupSubmitting);

  // Snapshot for synchronous reads
  private snap: GroupServiceState = { ...initialState };

  constructor(
    private api: ApiService,
    private router: Router,
    private offlineCache: OfflineCacheService,
  ) {}

  private setState(partial: Partial<GroupServiceState>): void {
    this.snap = { ...this.snap, ...partial };
    if (partial.groups !== undefined) this._groups.set(partial.groups);
    if (partial.groupsLoading !== undefined) this._groupsLoading.set(partial.groupsLoading);
    if (partial.groupsError !== undefined) this._groupsError.set(partial.groupsError);
    if (partial.activeGroup !== undefined) this._activeGroup.set(partial.activeGroup);
    if (partial.activeGroupJobId !== undefined) this._activeGroupJobId.set(partial.activeGroupJobId);
    if (partial.activeGroupId !== undefined) this._activeGroupId.set(partial.activeGroupId);
    if (partial.reindexGroupPrefill !== undefined) this._reindexGroupPrefill.set(partial.reindexGroupPrefill);
    if (partial.groupSubmitError !== undefined) this._groupSubmitError.set(partial.groupSubmitError);
    if (partial.isGroupSubmitting !== undefined) this._isGroupSubmitting.set(partial.isGroupSubmitting);
  }

  // --------------------------------------------------------------------------
  // Group list
  // --------------------------------------------------------------------------

  async loadGroups(): Promise<void> {
    this.setState({ groupsLoading: true, groupsError: '' });
    try {
      const result = await firstValueFrom(this.api.listGroups());
      this.setState({ groups: result, groupsLoading: false });
    } catch (err) {
      this.setState({
        groupsError:
          (err instanceof Error ? err.message : String(err)) ||
          'No se pudieron cargar los grupos.',
        groupsLoading: false,
      });
    }
  }

  // --------------------------------------------------------------------------
  // Open / navigate
  // --------------------------------------------------------------------------

  /** Open an existing group — load its detail with offline fallback and navigate to group wiki. */
  async openExistingGroup(group: GroupSummary): Promise<void> {
    try {
      let detail: GroupDetail;
      try {
        detail = await firstValueFrom(this.api.getGroup(group.id));
        await this.offlineCache.setGroup(group.id, detail as any);
      } catch (netErr) {
        const cached = await this.offlineCache.getGroup(group.id);
        if (cached) {
          detail = cached as any;
        } else {
          throw netErr;
        }
      }
      this.setState({ activeGroup: detail });
      this.router.navigate(['/group', group.id]);
    } catch (err) {
      this.setState({
        groupsError: `Error al abrir el grupo "${group.name}": ${err instanceof Error ? err.message : 'Error desconocido'}`,
      });
    }
  }

  /** Load a group's detail and set it as active (without navigation). */
  async loadGroup(groupId: number): Promise<void> {
    try {
      const group = await firstValueFrom(this.api.getGroup(groupId));
      this.setState({ activeGroup: group });
    } catch {
      this.router.navigate(['/browse']);
    }
  }

  // --------------------------------------------------------------------------
  // Mutations
  // --------------------------------------------------------------------------

  async handleDeleteGroup(groupId: number): Promise<void> {
    await firstValueFrom(this.api.deleteGroup(groupId));
    await this.offlineCache.clearGroup(groupId);
    this.setState({
      groups: this.snap.groups.filter((g) => g.id !== groupId),
    });
  }

  handleReindexGroup(group: GroupSummary | null): void {
    if (!group) {
      this.setState({ reindexGroupPrefill: null, groupSubmitError: '' });
      return;
    }
    this.offlineCache.clearGroup(group.id);
    this.setState({ reindexGroupPrefill: group, groupSubmitError: '' });
  }

  async handleGroupConnect(payload: IndexGroupRequest): Promise<void> {
    this.setState({ isGroupSubmitting: true, groupSubmitError: '' });
    try {
      const res = await firstValueFrom(this.api.indexGroup(payload));
      this.setState({
        activeGroupJobId: res.job_id,
        activeGroupId: res.group_id,
        isGroupSubmitting: false,
      });
      this.router.navigate(['/group/indexing', res.group_id, res.job_id]);
    } catch (err) {
      this.setState({
        groupSubmitError:
          (err instanceof Error ? err.message : String(err)) ||
          'No se pudo iniciar el indexado del grupo.',
        isGroupSubmitting: false,
      });
    }
  }

  /** Called when a group indexing job completes. */
  onGroupJobDone(job: GroupJobResponse): void {
    this.handleGroupJobDone(job);
  }

  /** Called when a group indexing job completes. */
  async handleGroupJobDone(job: GroupJobResponse): Promise<void> {
    if (job.group_id) {
      try {
        const detail = await firstValueFrom(this.api.getGroup(job.group_id));
        await this.offlineCache.setGroup(job.group_id, detail as any);
        this.setState({ activeGroup: detail });
        this.router.navigate(['/group', job.group_id]);
      } catch {
        this.router.navigate(['/browse']);
      }
    } else {
      this.router.navigate(['/browse']);
    }
  }

  // --------------------------------------------------------------------------
  // Reset
  // --------------------------------------------------------------------------

  resetGroup(): void {
    this.setState({
      activeGroup: null,
      activeGroupJobId: null,
      activeGroupId: null,
      reindexGroupPrefill: null,
      groupSubmitError: '',
      isGroupSubmitting: false,
    });
  }
}
