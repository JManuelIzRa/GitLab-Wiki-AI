import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: '/browse', pathMatch: 'full' },
  {
    path: 'browse',
    loadComponent: () =>
      import('./components/repository-browser/repository-browser.component').then(
        (m) => m.RepositoryBrowserComponent,
      ),
  },
  {
    path: 'connect',
    loadComponent: () =>
      import('./components/connect-form/connect-form.component').then(
        (m) => m.ConnectFormComponent,
      ),
  },
  {
    path: 'connect/:repoId',
    loadComponent: () =>
      import('./components/connect-form/connect-form.component').then(
        (m) => m.ConnectFormComponent,
      ),
  },
  {
    path: 'indexing/:jobId',
    loadComponent: () =>
      import('./components/indexing-progress/indexing-progress.component').then(
        (m) => m.IndexingProgressComponent,
      ),
  },
  {
    path: 'wiki/:repoId',
    loadComponent: () =>
      import('./components/wiki-layout/wiki-layout.component').then(
        (m) => m.WikiLayoutComponent,
      ),
  },
  {
    path: 'group/connect',
    loadComponent: () =>
      import('./components/group-connect-form/group-connect-form.component').then(
        (m) => m.GroupConnectFormComponent,
      ),
  },
  {
    path: 'group/indexing/:groupId/:jobId',
    loadComponent: () =>
      import(
        './components/group-indexing-progress/group-indexing-progress.component'
      ).then((m) => m.GroupIndexingProgressComponent),
  },
  {
    path: 'group/:groupId',
    loadComponent: () =>
      import('./components/group-wiki-view/group-wiki-view.component').then(
        (m) => m.GroupWikiViewComponent,
      ),
  },
];
