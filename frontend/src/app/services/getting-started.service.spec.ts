import { TestBed } from '@angular/core/testing';
import { GettingStartedService, GETTING_STARTED_STEPS } from './getting-started.service';

const STORAGE_PROGRESS_KEY = 'atlas_onboarding_progress';
const STORAGE_DISMISSED_KEY = 'atlas_onboarding_dismissed';
const TOTAL_STEPS = GETTING_STARTED_STEPS.length;

describe('GettingStartedService', () => {
  let service: GettingStartedService;

  /** Helper: create a fresh service instance by resetting the testing module. */
  function createFreshService(): GettingStartedService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    return TestBed.inject(GettingStartedService);
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(GettingStartedService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  // --------------------------------------------------------------------------
  // Basics
  // --------------------------------------------------------------------------

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should initialize all steps as pending', () => {
    for (let i = 1; i <= TOTAL_STEPS; i++) {
      expect(service.getStepStatus(i)).toBe('pending');
    }
  });

  // --------------------------------------------------------------------------
  // Persistence
  // --------------------------------------------------------------------------

  it('should load persisted state from localStorage', () => {
    const saved = { 1: 'done', 2: 'done' } as Record<number, string>;
    localStorage.setItem(STORAGE_PROGRESS_KEY, JSON.stringify(saved));
    const s = createFreshService();
    expect(s.getStepStatus(1)).toBe('done');
    expect(s.getStepStatus(2)).toBe('done');
    expect(s.getStepStatus(3)).toBe('pending');
  });

  it('should mark step as completed and persist to localStorage', () => {
    service.markCompleted(1);
    expect(service.getStepStatus(1)).toBe('done');
    const stored = JSON.parse(localStorage.getItem(STORAGE_PROGRESS_KEY)!);
    expect(stored[1]).toBe('done');
  });

  it('should set step as in_progress', () => {
    service.setInProgress(2);
    expect(service.getStepStatus(2)).toBe('in_progress');
  });

  it('should gracefully degrade when localStorage throws on write', () => {
    spyOn(Storage.prototype, 'setItem').and.throwError('Storage full');
    expect(() => service.markCompleted(1)).not.toThrow();
    expect(service.getStepStatus(1)).toBe('done');
    expect(() => service.dismiss()).not.toThrow();
    expect(service.isDismissed()).toBeTrue();
  });

  it('should gracefully degrade when localStorage throws on read', () => {
    spyOn(Storage.prototype, 'getItem').and.throwError('Storage error');
    const s = createFreshService();
    expect(s).toBeTruthy();
    expect(s.getStepStatus(1)).toBe('pending');
  });

  // --------------------------------------------------------------------------
  // Locking logic
  // --------------------------------------------------------------------------

  it('should report step 1 as unlocked', () => {
    expect(service.isStepLocked(1)).toBeFalse();
  });

  it('should report step 2 as locked when step 1 is not done', () => {
    expect(service.isStepLocked(2)).toBeTrue();
  });

  it('should report step 2 as unlocked when step 1 is done', () => {
    service.markCompleted(1);
    expect(service.isStepLocked(2)).toBeFalse();
  });

  it('should report all steps after the first as locked when none are done', () => {
    for (let i = 2; i <= TOTAL_STEPS; i++) {
      expect(service.isStepLocked(i)).toBeTrue();
    }
  });

  // --------------------------------------------------------------------------
  // Computed signals
  // --------------------------------------------------------------------------

  it('should compute completedCount correctly', () => {
    expect(service.completedCount()).toBe(0);
    service.markCompleted(1);
    service.markCompleted(2);
    expect(service.completedCount()).toBe(2);
  });

  it('should compute isAllDone only when all steps done', () => {
    expect(service.isAllDone()).toBeFalse();
    for (let i = 1; i <= TOTAL_STEPS; i++) {
      service.markCompleted(i);
    }
    expect(service.isAllDone()).toBeTrue();
  });

  it('should compute progressPercent correctly', () => {
    expect(service.progressPercent()).toBe(0);
    service.markCompleted(1);
    service.markCompleted(2);
    expect(service.progressPercent()).toBe(40);
  });

  // --------------------------------------------------------------------------
  // Toggle
  // --------------------------------------------------------------------------

  it('should toggle manual step between pending and done', () => {
    service.toggleManual(1);
    expect(service.getStepStatus(1)).toBe('done');
    service.toggleManual(1);
    expect(service.getStepStatus(1)).toBe('pending');
  });

  it('should not toggle locked step', () => {
    service.toggleManual(2);
    expect(service.getStepStatus(2)).toBe('pending');
  });

  // --------------------------------------------------------------------------
  // Auto-progress evaluation
  // --------------------------------------------------------------------------

  it('should evaluate auto-progress with empty repos', () => {
    service.evaluateAutoProgress([], null);
    for (let i = 1; i <= TOTAL_STEPS; i++) {
      expect(service.getStepStatus(i)).toBe('pending');
    }
  });

  it('should evaluate auto-progress with indexed repos', () => {
    service.evaluateAutoProgress([{ indexed_in_qdrant: true }], null);
    expect(service.getStepStatus(1)).toBe('done');
    expect(service.getStepStatus(2)).toBe('done');
    expect(service.getStepStatus(3)).toBe('pending');
    expect(service.getStepStatus(4)).toBe('done');
    expect(service.getStepStatus(5)).toBe('pending');
  });

  it('should evaluate auto-progress with activeSlug setting step 3 done', () => {
    service.evaluateAutoProgress([{ indexed_in_qdrant: true }], 'some-page');
    expect(service.getStepStatus(1)).toBe('done');
    expect(service.getStepStatus(2)).toBe('done');
    expect(service.getStepStatus(3)).toBe('done');
    expect(service.getStepStatus(4)).toBe('done');
    expect(service.getStepStatus(5)).toBe('pending');
  });

  it('should not override existing progress with auto-progress', () => {
    service.markCompleted(1);
    service.evaluateAutoProgress([], null);
    // Step 1 was manually completed and should stay 'done'
    expect(service.getStepStatus(1)).toBe('done');
  });

  // --------------------------------------------------------------------------
  // Dismiss and reset
  // --------------------------------------------------------------------------

  it('should dismiss and persist', () => {
    service.dismiss();
    expect(service.isDismissed()).toBeTrue();
    expect(localStorage.getItem(STORAGE_DISMISSED_KEY)).toBe('true');
  });

  it('should reset all progress', () => {
    service.markCompleted(1);
    service.markCompleted(2);
    service.dismiss();
    service.reset();
    for (let i = 1; i <= TOTAL_STEPS; i++) {
      expect(service.getStepStatus(i)).toBe('pending');
    }
    expect(service.isDismissed()).toBeFalse();
    expect(localStorage.getItem(STORAGE_DISMISSED_KEY)).toBeNull();
    const progressRaw = localStorage.getItem(STORAGE_PROGRESS_KEY);
    expect(progressRaw).toBeTruthy();
    const parsed = JSON.parse(progressRaw!);
    expect(parsed[1]).toBe('pending');
  });

  it('should not affect other state when toggling unrelated step', () => {
    // Unlock step 3 by completing steps 1 and 2 first
    service.markCompleted(1);
    service.markCompleted(2);
    service.toggleManual(3);
    expect(service.getStepStatus(1)).toBe('done');
    expect(service.getStepStatus(3)).toBe('done');
  });
});
