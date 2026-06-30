import {
  Component,
  Output,
  EventEmitter,
  OnDestroy,
  AfterViewInit,
  ViewChild,
  ElementRef,
} from '@angular/core';

interface ShortcutEntry {
  keys: string[];
  description: string;
  category: string;
}

const SHORTCUTS: ShortcutEntry[] = [
  { keys: ['Alt', '←'], description: 'Página anterior del wiki', category: 'Navegación' },
  { keys: ['Alt', '→'], description: 'Página siguiente del wiki', category: 'Navegación' },
  { keys: ['/'], description: 'Enfocar la búsqueda del sidebar', category: 'Búsqueda y comandos' },
  { keys: ['Cmd', 'K'], description: 'Abrir paleta de comandos', category: 'Búsqueda y comandos' },
  { keys: ['?'], description: 'Mostrar / ocultar este panel de atajos', category: 'Paneles y modales' },
  { keys: ['Esc'], description: 'Cerrar modales / quitar foco del buscador', category: 'Paneles y modales' },
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

  @ViewChild('trapEl') set trapEl(el: ElementRef<HTMLElement>) {
    if (el) {
      this.trapRef = el.nativeElement;
      this.trapFocus();
    }
  }

  private keydownHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.close.emit();
  };

  ngAfterViewInit(): void {
    document.addEventListener('keydown', this.keydownHandler);
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
