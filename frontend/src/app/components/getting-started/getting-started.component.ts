import {
  Component,
  OnInit,
  signal,
  computed,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { RepoService } from '../../services/repo.service';
import { GroupService } from '../../services/group.service';
import {
  GettingStartedService,
  GETTING_STARTED_STEPS,
} from '../../services/getting-started.service';

interface ShortcutEntry {
  keys: string;
  desc: string;
}

@Component({
  selector: 'app-getting-started',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './getting-started.component.html',
  styleUrls: ['./getting-started.component.css'],
})
export class GettingStartedComponent implements OnInit {
  readonly expandedStep = signal<number | null>(null);

  readonly repoCount = computed(() => this.repoService.repositories().length);
  readonly groupCount = computed(() => this.groupService.groups().length);
  readonly completedCount = computed(() => this.gettingStartedService.completedCount);
  readonly progressPercent = computed(() => this.gettingStartedService.progressPercent);
  readonly isAllDone = computed(() => this.gettingStartedService.isAllDone);

  readonly steps = computed(() =>
    GETTING_STARTED_STEPS.map((s) => ({
      ...s,
      status: this.gettingStartedService.getStepStatus(s.id),
      locked: this.gettingStartedService.isStepLocked(s.id),
    })),
  );

  readonly shortcuts: ShortcutEntry[] = [
    { keys: 'Alt+← / Alt+→', desc: 'Navegar entre páginas' },
    { keys: '/', desc: 'Buscar en el wiki' },
    { keys: '?', desc: 'Mostrar atajos de teclado' },
    { keys: 'Cmd+K / Ctrl+K', desc: 'Paleta de comandos' },
    { keys: 'T', desc: 'Alternar tema claro/oscuro' },
    { keys: 'Esc', desc: 'Cerrar panel' },
  ];

  constructor(
    public repoService: RepoService,
    public groupService: GroupService,
    public gettingStartedService: GettingStartedService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.gettingStartedService.evaluateAutoProgress(
      this.repoService.repositories(),
      this.repoService.activeSlug(),
    );
  }

  toggleStep(stepId: number): void {
    this.expandedStep.update((current) => (current === stepId ? null : stepId));
  }

  handleCta(stepId: number): void {
    const repos = this.repoService.repositories();
    const firstRepo = repos.length > 0 ? repos[0] : null;

    switch (stepId) {
      case 1:
        this.router.navigate(['/connect']);
        break;
      case 2:
        if (!firstRepo) {
          this.router.navigate(['/connect']);
        } else {
          this.router.navigate(['/wiki', firstRepo.id]);
        }
        break;
      case 3:
        if (firstRepo) {
          this.router.navigate(['/wiki', firstRepo.id]);
        }
        break;
      case 4:
        if (firstRepo) {
          this.router.navigate(['/wiki', firstRepo.id]);
        }
        break;
      case 5:
        // No navigation — features are explained in the detail panel
        break;
    }
  }

  handleDismiss(): void {
    this.gettingStartedService.dismiss();
    this.router.navigate(['/browse']);
  }

  handleToggleCheck(stepId: number, event: MouseEvent): void {
    event.stopPropagation();
    this.gettingStartedService.toggleManual(stepId);
  }

  resetTutorial(): void {
    this.gettingStartedService.reset();
  }
}
