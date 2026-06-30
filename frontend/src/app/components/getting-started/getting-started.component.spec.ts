import { TestBed, ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { GettingStartedComponent } from './getting-started.component';
import { RepoService } from '../../services/repo.service';
import { GroupService } from '../../services/group.service';
import { GettingStartedService } from '../../services/getting-started.service';

describe('GettingStartedComponent', () => {
  let component: GettingStartedComponent;
  let fixture: ComponentFixture<GettingStartedComponent>;
  let gettingStartedService: {
    completedCount: ReturnType<typeof signal<number>>;
    progressPercent: ReturnType<typeof signal<number>>;
    isAllDone: ReturnType<typeof signal<boolean>>;
    getStepStatus: jasmine.Spy;
    isStepLocked: jasmine.Spy;
    evaluateAutoProgress: jasmine.Spy;
    markCompleted: jasmine.Spy;
    setInProgress: jasmine.Spy;
    toggleManual: jasmine.Spy;
    dismiss: jasmine.Spy;
    reset: jasmine.Spy;
  };
  let repoService: {
    repositories: ReturnType<typeof signal<any[]>>;
    activeSlug: ReturnType<typeof signal<string | null>>;
  };
  let groupService: {
    groups: ReturnType<typeof signal<any[]>>;
  };
  let router: Router;

  beforeEach(async () => {
    repoService = {
      repositories: signal<any[]>([]),
      activeSlug: signal<string | null>(null),
    };

    groupService = {
      groups: signal<any[]>([]),
    };

    gettingStartedService = {
      completedCount: signal<number>(0),
      progressPercent: signal<number>(0),
      isAllDone: signal<boolean>(false),
      getStepStatus: jasmine.createSpy('getStepStatus').and.returnValue('pending'),
      isStepLocked: jasmine.createSpy('isStepLocked').and.returnValue(false),
      evaluateAutoProgress: jasmine.createSpy('evaluateAutoProgress'),
      markCompleted: jasmine.createSpy('markCompleted'),
      setInProgress: jasmine.createSpy('setInProgress'),
      toggleManual: jasmine.createSpy('toggleManual'),
      dismiss: jasmine.createSpy('dismiss'),
      reset: jasmine.createSpy('reset'),
    };

    await TestBed.configureTestingModule({
      imports: [
        GettingStartedComponent,
        RouterTestingModule.withRoutes([]),
      ],
      providers: [
        { provide: RepoService, useValue: repoService },
        { provide: GroupService, useValue: groupService },
        { provide: GettingStartedService, useValue: gettingStartedService as any },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    spyOn(router, 'navigate');

    fixture = TestBed.createComponent(GettingStartedComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // --------------------------------------------------------------------------
  // Basics
  // --------------------------------------------------------------------------

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should render 5 checklist steps', () => {
    const stepCards = fixture.nativeElement.querySelectorAll('.step-card');
    expect(stepCards.length).toBe(5);
  });

  // --------------------------------------------------------------------------
  // Progress bar
  // --------------------------------------------------------------------------

  it('should display progress bar with correct percentage', () => {
    gettingStartedService.completedCount.set(2);
    gettingStartedService.progressPercent.set(40);
    fixture.detectChanges();

    const progressFill: HTMLElement =
      fixture.nativeElement.querySelector('.progress-fill');
    expect(progressFill).toBeTruthy();

    const progressLabel: HTMLElement =
      fixture.nativeElement.querySelector('.progress-label');
    expect(progressLabel).toBeTruthy();
    expect(progressLabel.textContent).toContain('5 completado');
  });

  // --------------------------------------------------------------------------
  // Expand / collapse
  // --------------------------------------------------------------------------

  it('should expand detail panel on step click', () => {
    // Initially no detail panel
    expect(fixture.nativeElement.querySelector('.detail-panel')).toBeFalsy();
    expect(component.expandedStep()).toBeNull();

    // Click first step card
    const stepCards = fixture.nativeElement.querySelectorAll('.step-card');
    stepCards[0].click();
    fixture.detectChanges();

    expect(component.expandedStep()).toBe(1);
    expect(fixture.nativeElement.querySelector('.detail-panel')).toBeTruthy();
  });

  it('should collapse previous panel when new step is expanded', () => {
    const stepCards = fixture.nativeElement.querySelectorAll('.step-card');

    // Expand step 1
    stepCards[0].click();
    fixture.detectChanges();
    expect(component.expandedStep()).toBe(1);

    // Expand step 2 — step 1 should collapse
    stepCards[1].click();
    fixture.detectChanges();

    expect(component.expandedStep()).toBe(2);
    // Only one detail panel visible at a time
    const panels = fixture.nativeElement.querySelectorAll('.detail-panel');
    expect(panels.length).toBe(1);
  });

  // --------------------------------------------------------------------------
  // CTA navigation
  // --------------------------------------------------------------------------

  it('should navigate to /connect when step 1 CTA is clicked', () => {
    const stepCards = fixture.nativeElement.querySelectorAll('.step-card');
    const ctaButton = stepCards[0].querySelector('.step-cta') as HTMLElement;
    expect(ctaButton).toBeTruthy();

    ctaButton.click();
    fixture.detectChanges();

    expect(router.navigate).toHaveBeenCalledWith(['/connect']);
  });

  // --------------------------------------------------------------------------
  // Dismiss
  // --------------------------------------------------------------------------

  it('should call dismiss and navigate to /browse when dismiss button clicked', () => {
    const dismissBtn: HTMLElement =
      fixture.nativeElement.querySelector('.dismiss-btn')!;
    expect(dismissBtn).toBeTruthy();

    dismissBtn.click();
    fixture.detectChanges();

    expect(gettingStartedService.dismiss).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/browse']);
  });

  // --------------------------------------------------------------------------
  // Completion banner
  // --------------------------------------------------------------------------

  it('should show completion banner when all steps done', () => {
    // Set isAllDone to true — the component's template reads this via the
    // mock signal, so we set it before detecting changes
    gettingStartedService.isAllDone.set(true);
    fixture.detectChanges();

    const banner: HTMLElement =
      fixture.nativeElement.querySelector('.completion-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('Todo completado');
  });

  // --------------------------------------------------------------------------
  // Help sidebar
  // --------------------------------------------------------------------------

  it('should show help sidebar on desktop viewport', () => {
    const sidebar: HTMLElement =
      fixture.nativeElement.querySelector('.help-sidebar');
    expect(sidebar).toBeTruthy();
  });

  it('should display keyboard shortcuts in help sidebar', () => {
    const shortcutRows =
      fixture.nativeElement.querySelectorAll('.shortcut-row');
    expect(shortcutRows.length).toBeGreaterThanOrEqual(4);

    // Verify the actual count matches the component's hardcoded shortcuts
    expect(shortcutRows.length).toBe(6);
  });

  // --------------------------------------------------------------------------
  // Stats
  // --------------------------------------------------------------------------

  it('should display repo and group counts in stats section', () => {
    // Set mock repositories and groups
    repoService.repositories.set([
      { id: 1, name: 'repo1' } as any,
      { id: 2, name: 'repo2' } as any,
      { id: 3, name: 'repo3' } as any,
    ]);
    repoService.activeSlug.set('wiki-page');
    // Step 1 is auto-done via evaluateAutoProgress because repos.length > 0
    gettingStartedService.getStepStatus.and.callFake((id: number) =>
      id === 1 ? 'done' : 'pending',
    );

    groupService.groups.set([{ id: 1, name: 'group1' } as any]);

    fixture.detectChanges();

    const statRows = fixture.nativeElement.querySelectorAll('.stat-row');
    expect(statRows.length).toBe(2);
    expect(statRows[0].textContent).toContain('3');
    expect(statRows[0].textContent).toContain('repositorio');
    expect(statRows[1].textContent).toContain('1');
    expect(statRows[1].textContent).toContain('grupo');
  });

  // --------------------------------------------------------------------------
  // Toggle manual
  // --------------------------------------------------------------------------

  it('should call toggleManual when checkbox icon is clicked on pending step', () => {
    const stepCards = fixture.nativeElement.querySelectorAll('.step-card');

    // Step 1 is pending by default, so it has an .icon-pending element
    const pendingIcon = stepCards[0].querySelector('.icon-pending') as HTMLElement;
    expect(pendingIcon).toBeTruthy();

    pendingIcon.click();
    fixture.detectChanges();

    expect(gettingStartedService.toggleManual).toHaveBeenCalledWith(1);
  });

  // --------------------------------------------------------------------------
  // Init lifecycle
  // --------------------------------------------------------------------------

  it('should call evaluateAutoProgress on init', () => {
    // ngOnInit runs during fixture.detectChanges() in beforeEach,
    // so the spy should already have been called
    expect(gettingStartedService.evaluateAutoProgress).toHaveBeenCalledWith(
      [],
      null,
    );
  });

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------

  it('should toggle expanded step to null when clicking same step twice', () => {
    const stepCards = fixture.nativeElement.querySelectorAll('.step-card');

    // Click to expand
    stepCards[0].click();
    fixture.detectChanges();
    expect(component.expandedStep()).toBe(1);

    // Click again to collapse
    stepCards[0].click();
    fixture.detectChanges();
    expect(component.expandedStep()).toBeNull();
    expect(fixture.nativeElement.querySelector('.detail-panel')).toBeFalsy();
  });

  it('should call resetTutorial when reset link is clicked after all done', () => {
    gettingStartedService.isAllDone.set(true);
    fixture.detectChanges();

    const resetLink: HTMLElement =
      fixture.nativeElement.querySelector('.reset-link')!;
    expect(resetLink).toBeTruthy();

    resetLink.click();
    fixture.detectChanges();

    expect(gettingStartedService.reset).toHaveBeenCalled();
  });
});
