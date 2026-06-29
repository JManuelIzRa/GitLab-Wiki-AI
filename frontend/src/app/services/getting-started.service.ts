import { Injectable, signal, computed } from '@angular/core';

export type StepKey = 'connect_repo' | 'indexing' | 'explore_wiki' | 'ask_question' | 'discover';
export type StepStatus = 'pending' | 'in_progress' | 'done';

export interface GettingStartedStep {
  id: number;
  key: StepKey;
  title: string;
  description: string;
}

export const GETTING_STARTED_STEPS: GettingStartedStep[] = [
  { id: 1, key: 'connect_repo', title: 'Conectar repositorio', description: 'Vincula tu primer proyecto de GitLab' },
  { id: 2, key: 'indexing', title: 'Indexación', description: 'Espera mientras se genera tu wiki con IA' },
  { id: 3, key: 'explore_wiki', title: 'Explorar wiki', description: 'Navega por la estructura y las páginas' },
  { id: 4, key: 'ask_question', title: 'Preguntar sobre el código', description: 'Consulta la inteligencia del repositorio' },
  { id: 5, key: 'discover', title: 'Descubrir funciones', description: 'Aprovecha al máximo Atlas' },
];

const STORAGE_PROGRESS_KEY = 'atlas_onboarding_progress';
const STORAGE_DISMISSED_KEY = 'atlas_onboarding_dismissed';

function loadProgress(): Record<number, StepStatus> {
  try {
    const raw = localStorage.getItem(STORAGE_PROGRESS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<number, StepStatus>;
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    }
  } catch {
    /* localStorage unavailable */
  }
  return { 1: 'pending', 2: 'pending', 3: 'pending', 4: 'pending', 5: 'pending' };
}

function loadDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveProgress(progress: Record<number, StepStatus>): void {
  try {
    localStorage.setItem(STORAGE_PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    /* localStorage unavailable */
  }
}

function saveDismissed(value: boolean): void {
  try {
    if (value) {
      localStorage.setItem(STORAGE_DISMISSED_KEY, 'true');
    } else {
      localStorage.removeItem(STORAGE_DISMISSED_KEY);
    }
  } catch {
    /* localStorage unavailable */
  }
}

@Injectable({ providedIn: 'root' })
export class GettingStartedService {
  private readonly _steps = signal<Record<number, StepStatus>>(loadProgress());
  private readonly _isDismissed = signal<boolean>(loadDismissed());

  readonly steps = this._steps.asReadonly();
  readonly isDismissed = this._isDismissed.asReadonly();

  readonly totalSteps = 5;

  readonly completedCount = computed(() => {
    const all = this._steps();
    let count = 0;
    for (const status of Object.values(all)) {
      if (status === 'done') count++;
    }
    return count;
  });

  readonly isAllDone = computed(() => this.completedCount() === this.totalSteps);

  readonly progressPercent = computed(() => {
    return Math.round((this.completedCount() / this.totalSteps) * 100);
  });

  // --------------------------------------------------------------------------
  // Mutations
  // --------------------------------------------------------------------------

  markCompleted(stepId: number): void {
    this._steps.update((prev) => {
      const next = { ...prev, [stepId]: 'done' as StepStatus };
      saveProgress(next);
      return next;
    });
  }

  setInProgress(stepId: number): void {
    this._steps.update((prev) => ({ ...prev, [stepId]: 'in_progress' as StepStatus }));
  }

  getStepStatus(stepId: number): StepStatus {
    return this._steps()[stepId] ?? 'pending';
  }

  isStepLocked(stepId: number): boolean {
    if (stepId <= 1) return false;
    // Locked if any prior step is not 'done'
    for (let id = 1; id < stepId; id++) {
      if (this._steps()[id] !== 'done') return true;
    }
    return false;
  }

  toggleManual(stepId: number): void {
    const current = this._steps()[stepId];
    // Only allow toggling if the step is unlockable
    if (this.isStepLocked(stepId)) return;
    const next: StepStatus = current === 'done' ? 'pending' : 'done';
    this._steps.update((prev) => {
      const updated = { ...prev, [stepId]: next };
      saveProgress(updated);
      return updated;
    });
  }

  dismiss(): void {
    this._isDismissed.set(true);
    saveDismissed(true);
  }

  reset(): void {
    const allPending: Record<number, StepStatus> = { 1: 'pending', 2: 'pending', 3: 'pending', 4: 'pending', 5: 'pending' };
    this._steps.set(allPending);
    saveProgress(allPending);
    this._isDismissed.set(false);
    saveDismissed(false);
  }

  // --------------------------------------------------------------------------
  // Auto-progress evaluation
  // --------------------------------------------------------------------------

  /**
   * Evaluate external state to auto-advance steps that can be inferred.
   * Step 5 ('discover') is only manual — never auto-advanced.
   */
  evaluateAutoProgress(repos: any[], activeSlug: string | null): void {
    this._steps.update((prev) => {
      const next = { ...prev };

      // Step 1 ('connect_repo') — done if repos.length > 0
      if (repos.length > 0 && next[1] !== 'done') {
        next[1] = 'done';
      }

      // Step 2 ('indexing') — done if any repo is indexed
      const hasIndexed = repos.some((r) => r.indexed_in_qdrant);
      if (hasIndexed && next[2] !== 'done') {
        next[2] = 'done';
      }

      // Step 3 ('explore_wiki') — done if activeSlug is not null
      if (activeSlug !== null && next[3] !== 'done') {
        next[3] = 'done';
      }

      // Step 4 ('ask_question') — same trigger as step 2
      if (hasIndexed && next[4] !== 'done') {
        next[4] = 'done';
      }

      // Step 5 ('discover') — only manual

      saveProgress(next);
      return next;
    });
  }
}
