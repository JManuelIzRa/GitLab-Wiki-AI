import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  message: string;
  type: 'info' | 'error' | 'warning' | 'success';
  autoDismissMs: number;
}

let nextId = 0;

@Injectable({ providedIn: 'root' })
export class ToastService {
  private _toasts = signal<Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();

  show(
    message: string,
    type: Toast['type'] = 'info',
    autoDismissMs = 5000,
  ): void {
    const id = nextId++;
    this._toasts.update((list) => [...list, { id, message, type, autoDismissMs }]);
    if (autoDismissMs > 0) {
      setTimeout(() => this.dismiss(id), autoDismissMs);
    }
  }

  dismiss(id: number): void {
    this._toasts.update((list) => list.filter((t) => t.id !== id));
  }

  /** Shorthand for error toasts. */
  error(message: string): void {
    this.show(message, 'error', 8000);
  }

  /** Shorthand for success toasts. */
  success(message: string): void {
    this.show(message, 'success', 4000);
  }

  /** Shorthand for warning toasts. */
  warning(message: string): void {
    this.show(message, 'warning', 6000);
  }
}
