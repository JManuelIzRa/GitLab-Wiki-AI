import {
  Component,
  Output,
  EventEmitter,
  inject,
  OnDestroy,
  AfterViewInit,
} from '@angular/core';

const SHORTCUTS = [
  { keys: ['?'], description: 'Mostrar / ocultar este panel de atajos' },
  { keys: ['/'], description: 'Enfocar la búsqueda del sidebar' },
  { keys: ['Alt', '←'], description: 'Página anterior del wiki' },
  { keys: ['Alt', '→'], description: 'Página siguiente del wiki' },
  { keys: ['Esc'], description: 'Cerrar modales / quitar foco del buscador' },
];

@Component({
  selector: 'app-keyboard-shortcuts-modal',
  standalone: true,
  imports: [],
  templateUrl: './keyboard-shortcuts-modal.component.html',
  styleUrls: ['./keyboard-shortcuts-modal.component.css'],
})
export class KeyboardShortcutsModalComponent implements AfterViewInit, OnDestroy {
  @Output() close = new EventEmitter<void>();

  readonly shortcuts = SHORTCUTS;
  private trapRef!: HTMLElement;

  private keydownHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.close.emit();
  };

  ngAfterViewInit(): void {
    document.addEventListener('keydown', this.keydownHandler);
    this.trapFocus();
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.keydownHandler);
  }

  onOverlayClick(): void {
    this.close.emit();
  }

  onModalClick(e: MouseEvent): void {
    e.stopPropagation();
  }

  private trapFocus(): void {
    if (!this.trapRef) return;
    const focusable = this.trapRef.querySelectorAll<HTMLElement>(
      'button, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first?.focus();

    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    this.trapRef.addEventListener('keydown', handler);
  }
}
