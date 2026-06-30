import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-error-fallback',
  standalone: true,
  imports: [],
  template: `
    <div class="error-fallback">
      <div class="error-icon">⚠</div>
      <div class="error-message">{{ message() }}</div>
      @if (showRetry()) {
        <button class="error-retry" (click)="retry.emit()">intentar de nuevo</button>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .error-fallback {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 40px 24px;
      text-align: center;
    }
    .error-icon {
      font-size: 28px;
      color: var(--accent-red);
    }
    .error-message {
      font-size: 13px;
      color: var(--text-tertiary);
      line-height: 1.5;
      max-width: 360px;
    }
    .error-retry {
      background: var(--bg-elevated-2);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      padding: 8px 16px;
      font-size: 12px;
      font-family: var(--font-mono);
      color: var(--accent-rust);
      cursor: pointer;
    }
    .error-retry:hover {
      background: var(--bg-hover);
    }
  `],
})
export class ErrorFallbackComponent {
  /** Error message to display. */
  message = input('Algo salió mal.');
  /** Whether to show a retry button. */
  showRetry = input(true);
  /** Emitted when the user clicks retry. */
  retry = output<void>();
}
