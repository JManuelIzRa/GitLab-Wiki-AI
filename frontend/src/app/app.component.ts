import { Component, signal, inject, OnDestroy } from '@angular/core';
import { RouterOutlet, Router, NavigationStart, NavigationEnd, NavigationCancel, NavigationError } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { ToastContainerComponent } from './components/toast-container/toast-container.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ToastContainerComponent],
  template: `
    <div class="app-shell">
      @if (routeLoading()) {
        <div class="route-loading-bar"><div class="route-loading-bar-inner"></div></div>
      }
      <router-outlet />
      <app-toast-container />
    </div>
  `,
  styles: [`
    .app-shell { min-height: 100vh; }
    .route-loading-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 2px;
      z-index: 9999;
      overflow: hidden;
    }
    .route-loading-bar-inner {
      height: 100%;
      width: 40%;
      background: var(--accent-rust, #C97C4A);
      animation: loadingSlide 1.2s ease-in-out infinite;
      border-radius: 1px;
    }
  `],
})
export class AppComponent implements OnDestroy {
  routeLoading = signal(false);

  private router = inject(Router);
  private sub: Subscription;

  constructor() {
    this.sub = this.router.events
      .pipe(filter((e) =>
        e instanceof NavigationStart ||
        e instanceof NavigationEnd ||
        e instanceof NavigationCancel ||
        e instanceof NavigationError
      ))
      .subscribe((e) => {
        if (e instanceof NavigationStart) {
          this.routeLoading.set(true);
        } else {
          this.routeLoading.set(false);
        }
      });
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}
