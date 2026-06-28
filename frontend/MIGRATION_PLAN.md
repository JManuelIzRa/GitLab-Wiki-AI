# Migration Plan: React → Angular

## Current Architecture

| Layer | React Implementation | Files |
|---|---|---|
| **Bootstrap** | `main.jsx` → `App.jsx` (error boundary + state-driven view router) | 2 |
| **Views/Screens** | 7 screens routed by `useViewStore` (no react-router) | 7 JSX |
| **Components** | 14 components (sidebar, content, chat, modals, panels) | 14 JSX |
| **State** | 4 zustand stores (view, repo, group, theme) | 4 JS |
| **API** | `api/client.js` — custom fetch + SSE streaming | 1 JS |
| **Hooks** | 3 custom hooks (job polling, keyboard nav, focus trap) | 3 JS |
| **Utils** | 4 utility files (gitlab URLs, lang detection, mermaid, IndexedDB cache) | 4 JS |
| **Styling** | CSS variables + inline `style={}` objects (zero CSS-in-JS lib) | 1 CSS + N style objects |
| **Testing** | 5 test files (vitest + jsdom + @testing-library/react) | 5 |
| **Build** | Vite → nginx serves `dist/` | Dockerfile |

**Total: ~42 files, ~5,000 LOC**

---

## Phase 0 — Scaffold Angular Project

```bash
ng new frontend --standalone --routing --style=css --skip-tests
```

This creates an Angular 19 standalone app with:
- `src/app/` — components, services, guards
- `src/environments/` — env config
- Angular Router (replacing the manual state-driven router in `App.jsx`)
- Vite under the hood (Angular 17+ uses Vite for dev server)

**Config changes needed:**
- `angular.json` → set `outputPath: dist` to keep Dockerfile consistent
- `proxy.conf.json` → proxy `/api/` to backend for dev
- `src/environments/environment.ts` → `apiBaseUrl` from env var

---

## Phase 1 — Core Infrastructure (do first)

### 1.1 API Service → `src/app/services/api.service.ts`

| React | Angular |
|---|---|
| `api/client.js` — `request()` + `ApiError` class + SSE async generator | `ApiService` — inject `HttpClient`, SSE via `EventSource` wrapper |

```
// Current: api.streamAskQuestion() is an async generator yielding events
// Angular: RxJS Observable that wraps EventSource, emitting tokens + sources

streamAskQuestion(repoId, question, history, signal): Observable<StreamEvent>
```

The SSE patterns (both `streamAskQuestion` and `streamGroupChat`) map naturally to RxJS `Observable.create()` — cleaner than React's async generators.

### 1.2 Services → `src/app/services/`

| Zustand Store | Angular Service |
|---|---|
| `useRepoStore` | `RepoService` — `BehaviorSubject<RepoState>` + methods |
| `useViewStore` | `Router` + route guards (replace entirely) |
| `useGroupStore` | `GroupService` — `BehaviorSubject<GroupState>` + methods |
| `useThemeStore` | `ThemeService` — CSS class toggle on `<body>` |

**Key mapping:**
- zustand `get()` → `BehaviorSubject.value`
- zustand `set()` → `BehaviorSubject.next({...state, ...partial})`
- zustand selectors → `state$.pipe(map(s => s.field))` or Angular signals

### 1.3 App Router → replaces `useViewStore`

```
const routes: Routes = [
  { path: '', redirectTo: '/browse', pathMatch: 'full' },
  { path: 'browse', component: RepositoryBrowserComponent },
  { path: 'connect', component: ConnectFormComponent },
  { path: 'connect/:repoId', component: ConnectFormComponent },  // reindex
  { path: 'indexing/:jobId', component: IndexingProgressComponent },
  { path: 'wiki/:repoId', component: WikiLayoutComponent, children: [
    { path: '', redirectTo: 'page/:slug', pathMatch: 'full' },
    { path: 'page/:slug', component: WikiPageContentComponent },
  ]},
  { path: 'group/connect', component: GroupConnectFormComponent },
  { path: 'group/indexing/:groupId/:jobId', component: GroupIndexingProgressComponent },
  { path: 'group/:groupId', component: GroupWikiViewComponent },
];
```

**Benefits over current React approach:**
- URL is the source of truth (no manual `window.history.pushState`)
- Back/forward browser buttons work without `popstate` listeners
- Route params are directly injected
- Lazy loading is built-in

### 1.4 Utilities → `src/app/utils/`

| React | Angular |
|---|---|
| `gitlab.js` | `gitlab-url.ts` — pure functions, no change needed |
| `language.js` | `language.ts` — pure functions |
| `mermaid.js` | `mermaid.service.ts` — injectable singleton wrapping mermaid init |
| `offlineCache.js` | `offline-cache.service.ts` — injectable with IndexedDB |

All are pure functions or singletons — trivial migration.

---

## Phase 2 — Component Mapping (full table)

| # | React Component | Angular Component | Type | Notes |
|---|---|---|---|---|
| 1 | `App.jsx` | `AppComponent` shell | Route outlet | Just `<router-outlet>` |
| 2 | `main.jsx` ErrorBoundary | `ErrorHandler` class | Global | `@angular/core` ErrorHandler |
| 3 | `RepositoryBrowser` | `RepositoryBrowserComponent` | Page/routed | Tab state is local `activeTab` |
| 4 | `ConnectForm` | `ConnectFormComponent` | Page/routed | Validation → Angular reactive forms |
| 5 | `GroupConnectForm` | `GroupConnectFormComponent` | Page/routed | Same pattern, group-specific |
| 6 | `IndexingProgress` | `IndexingProgressComponent` | Page/routed | SSE via `RepoService` observable |
| 7 | `GroupIndexingProgress` | `GroupIndexingProgressComponent` | Page/routed | Polling via `GroupService` |
| 8 | `WikiLayout` | `WikiLayoutComponent` | Page/routed | Hosts sidebar + content + panels |
| 9 | `WikiSidebar` | `WikiSidebarComponent` | Child | Page filter + wiki search + actions |
| 10 | `WikiPageContent` | `WikiPageContentComponent` | Child/routed | Markdown + editor + revisions |
| 11 | `AskPanel` | `AskPanelComponent` | Child (sidebar) | Chat FAB + panel |
| 12 | `CodeSearch` | `CodeSearchComponent` | Modal overlay | Uses `@angular/cdk/overlay` or `dialog` |
| 13 | `DependencyGraphView` | `DependencyGraphViewComponent` | Modal overlay | Mermaid rendering |
| 14 | `RevisionPanel` | `RevisionPanelComponent` | Modal overlay | Diff view + restore |
| 15 | `PushToGitLabDialog` | `PushToGitLabDialogComponent` | Child of Revision | Small dialog |
| 16 | `RepoSettingsPanel` | `RepoSettingsPanelComponent` | Modal overlay | Settings form |
| 17 | `JobHistoryPanel` | `JobHistoryPanelComponent` | Modal overlay | Job list |
| 18 | `CommandPalette` | `CommandPaletteComponent` | Modal overlay | `cdk/overlay` |
| 19 | `KeyboardShortcutsModal` | `KeyboardShortcutsModalComponent` | Modal overlay | Simple table |
| 20 | `GroupWikiView` | `GroupWikiViewComponent` | Page/routed | Tab-based layout |
| 21 | `GroupBrowser` | `GroupBrowserComponent` | Child of RepositoryBrowser | Group list |
| 22 | `MermaidDiagram` | `MermaidDiagramComponent` | Reusable | Self-contained |
| 23 | `HighlightedCode` | `HighlightedCodeComponent` | Reusable | Prism → `highlight.js` or `ngx-highlightjs` |

---

## Phase 3 — Key Pattern Replacements

### 3.1 Inline styles → Angular component styles

The current codebase uses inline `const styles = {...}` objects in every component. This is the easiest part:

```
// React
const styles = { wrapper: { minHeight: "100vh", ... } }

// Angular — move to component stylesheet
:host { display: block; }
.wrapper { min-height: 100vh; }
```

All CSS variables (`--bg-base`, `--accent-rust`, etc.) in `index.css` become `styles.css` in Angular — they're already standard CSS, no migration needed.

### 3.2 Zustand selectors → Angular signals

```
// React
const repository = useRepoStore((s) => s.repository);
const pages = useRepoStore((s) => s.pages);

// Angular (signals)
private repoService = inject(RepoService);
repository = this.repoService.repository;      // signal
pages = this.repoService.pages;                // signal
```

### 3.3 React forms → Angular reactive forms

```
// React
const [gitlabUrl, setGitlabUrl] = useState("https://gitlab.com");
const [projectPath, setProjectPath] = useState("");
// ...manual validation functions

// Angular
form = new FormGroup({
  gitlabUrl: new FormControl('https://gitlab.com', [Validators.required, gitlabUrlValidator]),
  projectPath: new FormControl('', [Validators.required, projectPathValidator]),
  privateToken: new FormControl('', [Validators.required]),
});
```

### 3.4 SSE streaming → RxJS Observable

```
// React async generator
for await (const event of api.streamAskQuestion(repoId, q, history, signal)) {
  if (event.token) { /* update state */ }
  if (event.sources) { /* set sources */ }
}

// Angular Observable
this.apiService.streamAskQuestion(repoId, q, history).subscribe({
  next: (event) => {
    if (event.token) this.updateContent(event.token);
    if (event.sources) this.sources.set(event.sources);
  }
});
```

### 3.5 Event handlers → (click), (keydown), etc.

```
// React
<button onClick={handleReset} style={...}>

// Angular
<button (click)="handleReset()" class="...">
```

### 3.6 Lazy loading → Angular route-level lazy loading

```
// React — manual lazy() with named exports
const ConnectForm = lazyNamed(() => import("./components/ConnectForm"), "ConnectForm");

// Angular — built-in route-level lazy loading
{ path: 'connect', loadComponent: () => import('./connect-form.component').then(m => m.ConnectFormComponent) }
```

---

## Phase 4 — Library Replacements

| Library | React Version | Angular Replacement | Effort |
|---|---|---|---|
| `zustand` | ^5.0.14 | Angular Service + Signals | Low |
| `lucide-react` | ^1.21.0 | `lucide-angular` (exists) | Low |
| `mermaid` | ^11.15.0 | Same package (framework-agnostic) | None |
| `react-markdown` + `remark-gfm` | ^10.1.0 | `ngx-markdown` (supports GFM) | Low |
| `react-syntax-highlighter` | ^16.1.1 | `highlight.js` via `ngx-markdown` or `ngx-highlightjs` | Low |
| `react-testing-library` | ^16.3.0 | Angular `TestBed` + `Spectator` (optional) | Medium |
| `vitest` + `jsdom` | ^3.2.4 | Angular CLI default: `karma` or `jest` (ng default) | Medium |
| `vite` | ^8.0.12 | Angular CLI (uses Vite/esbuild since v17) | None |
| `react-router` | — (not used) | `@angular/router` | Low |
| `@vitejs/plugin-react` | ^6.0.1 | Not needed | None |
| `eslint` React plugins | — | Angular ESLint (`@angular-eslint`) | Low |

**Mermaid special case**: Already imported as a side-effect in `mermaid.js`. The singleton init + theme variables pattern is identical — just import it in the service instead of the module.

---

## Phase 5 — Docker / Build Changes

| File | Change |
|---|---|
| `frontend/Dockerfile` | Replace `FROM node:20-alpine` build with angular build: `ng build` instead of `vite build`. Output to `dist/` same as now. Nginx stage stays identical. |
| `frontend/nginx.conf` | **No change** — same SPA fallback pattern |
| `frontend/package.json` | Replace all deps (scripts change to `ng serve`, `ng build`, `ng test`) |
| `docker-compose.yml` | **No change** — still builds `./frontend` → nginx on port 80 |

---

## Phase 6 — Proposed Migration Order

```
Week 1 — Foundation (parallelizable)
├── Scaffold Angular app + routing
├── api.service.ts (full API client port)
├── RepoService + GroupService + ThemeService
├── OfflineCacheService
├── Utility files (gitlab, language, mermaid)
└── styles.css (port index.css CSS variables)

Week 2 — Core Screens
├── RepositoryBrowserComponent + GroupBrowserComponent
├── ConnectFormComponent + GroupConnectFormComponent
├── IndexingProgressComponent + GroupIndexingProgressComponent
├── WikiLayoutComponent (shell + sidebar)
├── WikiPageContentComponent (markdown + editor)
└── Angular Router wiring

Week 3 — Panels & Modals
├── AskPanelComponent (SSE chat)
├── CodeSearchComponent
├── MermaidDiagramComponent
├── HighlightedCodeComponent
├── DependencyGraphViewComponent
├── RevisionPanelComponent + PushToGitLabDialogComponent
├── RepoSettingsPanelComponent
├── JobHistoryPanelComponent
├── CommandPaletteComponent
└── KeyboardShortcutsModalComponent

Week 4 — Polish
├── GroupWikiViewComponent
├── Responsive CSS (port the @media blocks)
├── Test porting (vitest → Angular TestBed)
├── Dockerfile update
├── Delete all old React files
└── Smoke test full flow: connect → index → wiki → chat
```

---

## Risk Areas

1. **SSE streaming** — The async generator pattern in `api/client.js` is robust. Angular's RxJS `Observable` is a better fit architecturally, but the SSE parsing logic must be ported carefully. **Risk: Low.**
2. **Mermaid SSR incompatibility** — Already handled in React (client-side only). Angular's SSR is not used here (SPA + nginx). **Risk: None.**
3. **IndexedDB offline cache** — Pure IndexedDB — framework agnostic. Moves verbatim into a service. **Risk: None.**
4. **CSS variables** — The entire design system is CSS variables. They move verbatim into `styles.css`. **Risk: None.**
5. **`react-markdown` custom component overrides** — The code block handling (mermaid detection, Prism highlighting) is the trickiest port. `ngx-markdown` uses `highlight.js` with different API. The code block with mermaid detection needs custom Angular components registered as markdown renderers. **Risk: Medium.**
6. **Focus trap** — Currently a custom hook. Angular CDK has `FocusTrap` built-in via `@angular/cdk/a11y`. Better tested. **Risk: Low.**

---

## Estimated Sizing

- **Net new Angular code**: ~5,000 LOC (same as current, but in TypeScript)
- **Files to delete**: 42 old React files
- **Files unchanged**: `nginx.conf`, `docker-compose.yml`, README
- **Files modified**: `Dockerfile`, `package.json`, `.env.example`
- **Team effort**: 1 experienced Angular dev, ~3-4 weeks full-time
- **Can parallelize?**: Yes — service layer + component layer can be done in parallel by 2 devs (2 weeks)
