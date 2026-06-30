import { Component, inject } from '@angular/core';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [],
  template: `
    <div class="toast-container">
      @for (toast of toastService.toasts(); track toast.id) {
        <div
          class="toast"
          [class.toast-error]="toast.type === 'error'"
          [class.toast-warning]="toast.type === 'warning'"
          [class.toast-success]="toast.type === 'success'"
          [class.toast-info]="toast.type === 'info'"
          role="alert"
        >
          <span class="toast-msg">{{ toast.message }}</span>
          <button class="toast-close" (click)="toastService.dismiss(toast.id)" aria-label="Cerrar">✕</button>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: contents; }
    .toast-container {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
      max-width: 480px;
      width: 100%;
    }
    .toast {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 12.5px;
      font-family: var(--font-mono);
      pointer-events: auto;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
      animation: toastIn 0.2s ease-out;
    }
    .toast-info {
      background: var(--bg-elevated);
      border: 1px solid var(--border-strong);
      color: var(--text-primary);
    }
    .toast-error {
      background: #3A1818;
      border: 1px solid var(--accent-red);
      color: var(--text-error);
    }
    .toast-warning {
      background: #3A2A10;
      border: 1px solid #D9B98C;
      color: var(--text-warning);
    }
    .toast-success {
      background: #1A2E1A;
      border: 1px solid var(--accent-sage);
      color: var(--accent-sage);
    }
    .toast-msg {
      flex: 1;
      line-height: 1.4;
    }
    .toast-close {
      background: none;
      border: none;
      color: inherit;
      opacity: 0.6;
      cursor: pointer;
      font-size: 13px;
      padding: 0;
    }
    .toast-close:hover { opacity: 1; }
    @keyframes toastIn {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `],
})
export class ToastContainerComponent {
  toastService = inject(ToastService);
}
