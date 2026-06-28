import {
  Component,
  Input,
  AfterViewInit,
  OnDestroy,
  ElementRef,
  ViewChild,
  signal,
  inject,
} from '@angular/core';
import { MermaidService, MERMAID_DARK_VARS, MERMAID_LIGHT_VARS } from '../../services/mermaid.service';

@Component({
  selector: 'app-mermaid-diagram',
  standalone: true,
  imports: [],
  templateUrl: './mermaid-diagram.component.html',
  styleUrls: ['./mermaid-diagram.component.css'],
})
export class MermaidDiagramComponent implements AfterViewInit, OnDestroy {
  @Input() code = '';

  @ViewChild('container') containerRef!: ElementRef<HTMLElement>;

  private mermaidService = inject(MermaidService);

  error = signal<string | null>(null);
  isRendering = signal(true);
  zoomed = signal(false);
  copied = signal(false);
  svgSnapshot = signal('');

  private renderSeq = 0;
  private baseId = `mermaid-${Math.random().toString(36).slice(2, 8)}`;
  private mutationObserver: MutationObserver | null = null;
  private mermaidTheme: 'dark' | 'default' = 'dark';
  private retryCount = 0;

  ngAfterViewInit(): void {
    this.mermaidTheme =
      document.documentElement.getAttribute('data-theme') === 'light' ? 'default' : 'dark';

    // Observe theme changes
    this.mutationObserver = new MutationObserver(() => {
      this.mermaidTheme =
        document.documentElement.getAttribute('data-theme') === 'light' ? 'default' : 'dark';
      this.renderDiagram();
    });
    this.mutationObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    // Escape handler for zoom
    document.addEventListener('keydown', this.onKeyDown);

    this.renderDiagram();
  }

  ngOnDestroy(): void {
    this.mutationObserver?.disconnect();
    document.removeEventListener('keydown', this.onKeyDown);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.zoomed()) {
      this.zoomed.set(false);
    }
  };

  onRetry(): void {
    this.retryCount++;
    this.error.set(null);
    this.isRendering.set(true);
    this.renderDiagram();
  }

  onZoom(): void {
    if (!this.isRendering()) {
      this.zoomed.set(true);
    }
  }

  onZoomClose(): void {
    this.zoomed.set(false);
  }

  onCopyCode(e: MouseEvent): void {
    e.stopPropagation();
    navigator.clipboard.writeText(this.code).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1800);
    });
  }

  onDownloadSVG(): void {
    const svg = this.containerRef?.nativeElement?.innerHTML;
    if (!svg) return;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'diagram.svg';
    a.click();
    URL.revokeObjectURL(url);
  }

  private async renderDiagram(): Promise<void> {
    const seq = ++this.renderSeq;
    const renderId = `${this.baseId}-${seq}`;
    let cancelled = false;

    this.mermaidService.initialize(this.mermaidTheme);

    // 8s timeout
    const tid = setTimeout(() => {
      cancelled = true;
      document.getElementById(`d${renderId}`)?.remove();
      this.error.set('El diagrama tardó más de 8 s en renderizarse.');
      this.isRendering.set(false);
    }, 8_000);

    try {
      const { svg } = await this.mermaidService.render(renderId, this.code);
      clearTimeout(tid);
      if (!cancelled && this.containerRef) {
        this.containerRef.nativeElement.innerHTML = svg;
        this.svgSnapshot.set(svg);
        this.isRendering.set(false);
      }
    } catch (err: unknown) {
      clearTimeout(tid);
      document.getElementById(`d${renderId}`)?.remove();
      if (!cancelled) {
        this.error.set(
          err instanceof Error ? err.message : 'Error de sintaxis en el diagrama.'
        );
        this.isRendering.set(false);
      }
    }
  }
}
