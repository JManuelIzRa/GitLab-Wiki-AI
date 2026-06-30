import { Component, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { GroupService } from '../../services/group.service';
import { AtlasBrandComponent } from '../atlas-brand/atlas-brand.component';

@Component({
  selector: 'app-group-connect-form',
  imports: [ReactiveFormsModule, AtlasBrandComponent],
  templateUrl: './group-connect-form.component.html',
  styleUrls: ['./group-connect-form.component.css'],
  standalone: true,
})
export class GroupConnectFormComponent implements OnInit {
  form: FormGroup;
  showToken = signal(false);

  constructor(
    public groupService: GroupService,
    private router: Router,
  ) {
    const prefill = this.groupService.reindexGroupPrefill();
    this.form = new FormGroup({
      gitlabUrl: new FormControl(
        { value: prefill?.gitlab_url || 'https://gitlab.com', disabled: !!prefill },
        { validators: [Validators.required] },
      ),
      groupPath: new FormControl(
        { value: prefill?.group_path || '', disabled: !!prefill },
        { validators: [Validators.required] },
      ),
      privateToken: new FormControl('', { validators: [Validators.required] }),
      includeSubgroups: new FormControl(true),
    });
  }

  get isReindex(): boolean {
    return !!this.groupService.reindexGroupPrefill();
  }

  ngOnInit(): void {
    this.groupService.groupSubmitError.set('');
  }

  goBack(): void {
    this.router.navigate(['/browse']);
  }

  toggleShowToken(): void {
    this.showToken.update((v) => !v);
  }

  handleSubmit(event: Event): void {
    event.preventDefault();
    const gitlabUrl = String(this.form.value.gitlabUrl || '').trim();
    const groupPath = String(this.form.value.groupPath || '').trim();
    const privateToken = String(this.form.value.privateToken || '').trim();

    if (!gitlabUrl || !groupPath || !privateToken) return;

    this.groupService.handleGroupConnect({
      gitlab_url: gitlabUrl.replace(/\/+$/, ''),
      group_path: groupPath.replace(/^\/+/, ''),
      private_token: privateToken,
      include_subgroups: !!this.form.value.includeSubgroups,
      force_reindex: this.isReindex,
    });
  }
}
