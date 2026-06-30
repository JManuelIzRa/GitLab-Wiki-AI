import { ErrorHandler, Injectable, NgZone, inject } from '@angular/core';
import { ToastService } from './toast.service';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private toast = inject(ToastService);
  private ngZone = inject(NgZone);

  handleError(error: unknown): void {
    console.error('[Atlas] Unhandled error:', error);

    let message = 'Ocurrió un error inesperado.';
    if (error instanceof TypeError) {
      message = 'Error de red. Comprueba tu conexión.';
    } else if (error && typeof error === 'object') {
      const errObj = error as Record<string, unknown>;
      if (errObj['status'] === 429) {
        message = 'Demasiadas solicitudes. Espera un momento antes de continuar.';
      } else if (errObj['status'] === 401 || errObj['status'] === 403) {
        message = 'Error de autenticación. Verifica tu token de GitLab.';
      } else if (typeof errObj['message'] === 'string') {
        message = errObj['message'] as string;
      }
    }

    this.ngZone.run(() => {
      this.toast.error(message);
    });
  }
}
