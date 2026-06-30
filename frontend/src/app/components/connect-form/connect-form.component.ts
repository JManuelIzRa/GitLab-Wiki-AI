import { Component, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { RepoService } from '../../services/repo.service';
import { ApiService } from '../../services/api.service';
import { AtlasBrandComponent } from '../atlas-brand/atlas-brand.component';

function validateGitLabUrl(url: string): string | null {
  if (!url.trim()) return 'La URL es obligatoria';
  if (!/^https?:\/\/.+\..+/.test(url.trim())) return 'La URL debe comenzar con http:// o https:// e incluir un dominio v\u00e1lido';
  return null;
}

function validateProjectPath(path: string): string | null {
  if (!path.trim()) return 'La ruta del proyecto es obligatoria';
  if (/[<>"\s]/.test(path.trim())) return 'La ruta no puede contener espacios ni caracteres especiales';
  return null;
}

@Component({
  selector: 'app-connect-form',
  imports: [ReactiveFormsModule, AtlasBrandComponent],
  templateUrl: './connect-form.component.html',
  styleUrls: ['./connect-form.component.css'],
  standalone: true,
})
export class ConnectFormComponent implements OnInit {
  form: FormGroup;
  showToken = signal(false);
  branches = signal<string[]>([]);
  branchesLoading = signal(false);
  branchesError = signal('');

  private readonly DRAFT_KEY = 'connect_form_draft';

  constructor(
    public repoService: RepoService,
    private api: ApiService,
    private router: Router,
  ) {
    const prefill = this.repoService.reindexPrefill();

    if (prefill) {
      this.form = new FormGroup({
        gitlabUrl: new FormControl(
          { value: prefill.gitlab_url, disabled: true },
          { validators: [Validators.required] },
        ),
        projectPath: new FormControl(
          { value: prefill.project_path, disabled: true },
          { validators: [Validators.required] },
        ),
        privateToken: new FormControl('', { validators: [Validators.required] }),
        branch: new FormControl(
          prefill?.default_branch && prefill.default_branch !== 'main' ? prefill.default_branch : '',
        ),
      });
    } else {
      const draft = this.loadDraft();
      this.form = new FormGroup({
        gitlabUrl: new FormControl(draft?.['gitlabUrl'] || 'https://gitlab.com', { validators: [Validators.required] }),
        projectPath: new FormControl(draft?.['projectPath'] || '', { validators: [Validators.required] }),
        privateToken: new FormControl(draft?.['privateToken'] || '', { validators: [Validators.required] }),
        branch: new FormControl(draft?.['branch'] || ''),
      });
    }
  }

  get isReindex(): boolean {
    return !!this.repoService.reindexPrefill();
  }

  ngOnInit(): void {
    this.repoService.submitError.set('');

    if (!this.isReindex) {
      this.form.valueChanges.subscribe((values) => {
        try {
          localStorage.setItem(this.DRAFT_KEY, JSON.stringify(values));
        } catch {
          /* localStorage unavailable */
        }
      });
    }
  }

  private loadDraft(): Record<string, string> | null {
    try {
      const raw = localStorage.getItem(this.DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  private clearDraft(): void {
    try {
      localStorage.removeItem(this.DRAFT_KEY);
    } catch {
      /* ignore */
    }
  }

  goBack(): void {
    this.router.navigate(['/browse']);
  }

  toggleShowToken(): void {
    this.showToken.update((v) => !v);
  }

  fetchBranches(): void {
    const urlErr = validateGitLabUrl(this.form.value.gitlabUrl);
    if (urlErr) {
      this.branchesError.set(urlErr);
      return;
    }
    const projectPath = this.form.value.projectPath;
    const privateToken = this.form.value.privateToken;
    if (!projectPath.trim() || !privateToken.trim()) {
      this.branchesError.set('Completa la ruta del proyecto y el token antes de cargar las ramas.');
      return;
    }
    this.branchesLoading.set(true);
    this.branchesError.set('');
    this.branches.set([]);
    this.api.listBranches(
      this.form.value.gitlabUrl.trim().replace(/\/+$/, ''),
      projectPath.trim().replace(/^\/+/, ''),
      privateToken.trim(),
    ).subscribe({
      next: (res) => {
        const list = res || [];
        this.branches.set(list);
        const branchCtrl = this.form.get('branch');
        if (!branchCtrl!.value && list.length) {
          branchCtrl!.setValue(list[0]);
        }
        this.branchesLoading.set(false);
      },
      error: (err: Error) => {
        this.branchesError.set(err.message || 'No se pudieron cargar las ramas.');
        this.branchesLoading.set(false);
      },
    });
  }

  handleSubmit(event: Event): void {
    event.preventDefault();
    const gitlabUrl = this.form.value.gitlabUrl || '';
    const projectPath = this.form.value.projectPath || '';
    const privateToken = this.form.value.privateToken || '';
    const branch = this.form.value.branch || '';

    const urlErr = validateGitLabUrl(gitlabUrl);
    const pathErr = validateProjectPath(projectPath);
    const urlCtrl = this.form.get('gitlabUrl');
    const pathCtrl = this.form.get('projectPath');
    if (urlErr) urlCtrl!.setErrors({ custom: urlErr });
    else urlCtrl!.setErrors(null);
    if (pathErr) pathCtrl!.setErrors({ custom: pathErr });
    else pathCtrl!.setErrors(null);
    if (urlErr || pathErr || !privateToken.trim()) return;

    this.clearDraft();

    this.repoService.handleConnect({
      gitlab_url: gitlabUrl.trim().replace(/\/+$/, ''),
      project_path: projectPath.trim().replace(/^\/+/, ''),
      private_token: privateToken.trim(),
      branch: branch.trim() || null,
      force_reindex: this.isReindex,
    });
  }
}
