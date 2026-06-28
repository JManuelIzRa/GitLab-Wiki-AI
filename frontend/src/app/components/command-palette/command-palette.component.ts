import {
  Component,
  Input,
  Output,
  EventEmitter,
  signal,
  computed,
  inject,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
} from '@angular/core';
import { RepoService } from '../../services/repo.service';

export interface CommandPaletteAction {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

@Component({
  selector: 'app-command-palette',
  standalone: true,
  imports: [],
  templateUrl: './command-palette.component.html',
  styleUrls: ['./command-palette.component.css'],
})
export class CommandPaletteComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) open = false;
  @Input({ required: true }) actions: CommandPaletteAction[] = [];
  @Output() close = new EventEmitter<void>();

  @ViewChild('filterInput') filterInputRef!: ElementRef<HTMLInputElement>;

  private repoService = inject(RepoService);
  private trapRef!: HTMLElement;

  query = signal('');
  pages = this.repoService.pages;

  @ViewChild('trapEl') set trapEl(el: ElementRef<HTMLElement>) {
    if (el) {
      this.trapRef = el.nativeElement;
      if (this.open) this.trapFocus();
    }
  }

  readonly entries = computed(() => {
    const q = this.query().toLowerCase();
    const pageEntries = this.pages().map((page: any) => ({
      id: `page-${page.slug}`,
      label: page.title,
      hint: 'página',
      run: () => this.repoService.setActiveSlug(page.slug),
    }));
    return [...this.actions, ...pageEntries]
      .filter(
        (entry) =>
          `${entry.label} ${entry.hint || ''}`.toLowerCase().includes(q),
      )
      .slice(0, 12);
  });

  private keydownHandler?: (e: KeyboardEvent) => void;

  ngAfterViewInit(): void {
    if (this.open) {
      setTimeout(() => this.filterInputRef?.nativeElement?.focus(), 50);
    }
  }

  ngOnDestroy(): void {
    this.removeKeydownHandler();
  }

  onOpenChange(): void {
    if (this.open) {
      this.query.set('');
      setTimeout(() => this.filterInputRef?.nativeElement?.focus(), 50);
      this.addKeydownHandler();
      this.trapFocus();
    } else {
      this.removeKeydownHandler();
    }
  }

  onOverlayClick(): void {
    this.doClose();
  }

  onModalClick(e: MouseEvent): void {
    e.stopPropagation();
  }

  onEntryClick(entry: CommandPaletteAction): void {
    entry.run();
    this.doClose();
  }

  private doClose(): void {
    this.query.set('');
    this.close.emit();
  }

  private addKeydownHandler(): void {
    this.removeKeydownHandler();
    this.keydownHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        this.doClose();
      }
    };
    document.addEventListener('keydown', this.keydownHandler);
  }

  private removeKeydownHandler(): void {
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = undefined;
    }
  }

  private trapFocus(): void {
    if (!this.trapRef) return;
    const focusable = this.trapRef.querySelectorAll<HTMLElement>(
      'button, input, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    this.trapRef.addEventListener('keydown', handler);
  }
}
