import {
  Component,
  Output,
  EventEmitter,
  signal,
  inject,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
} from '@angular/core';
import { ApiService, DependencyGraphResponse } from '../../services/api.service';
import { MermaidService } from '../../services/mermaid.service';
import { RepoService } from '../../services/repo.service';

function sanitizeNodeId(name: string): string {
  return 'n_' + name.replace(/[^a-zA-Z0-9]/g, '_');
}

function graphToMermaid(graph: DependencyGraphResponse): string | null {
  if (!graph.nodes.length) return null;
  const lines = ['flowchart LR'];
  const idMap = new Map(graph.nodes.map((n) => [n, sanitizeNodeId(n)]));

  for (const node of graph.nodes) {
    lines.push(`  ${idMap.get(node)}["${node}"]`);
  }
  for (const edge of graph.edges) {
    const sourceId = idMap.get(edge.source);
    const targetId = idMap.get(edge.target);
    if (!sourceId || !targetId) continue;
    const label = edge.weight > 1 ? `|${edge.weight}|` : '';
    lines.push(`  ${sourceId} -->${label} ${targetId}`);
  }
  return lines.join('\n');
}

@Component({
  selector: 'app-dependency-graph-view',
  standalone: true,
  imports: [],
  templateUrl: './dependency-graph-view.component.html',
  styleUrls: ['./dependency-graph-view.component.css'],
})
export class DependencyGraphViewComponent implements AfterViewInit, OnDestroy {
  @Output() close = new EventEmitter<void>();

  @ViewChild('container') containerRef!: ElementRef<HTMLElement>;

  private api = inject(ApiService);
  private mermaidService = inject(MermaidService);
  private repoService = inject(RepoService);

  repository = this.repoService.repository;
  graph = signal<DependencyGraphResponse | null>(null);
  error = signal('');
  loading = signal(true);
  copied = signal(false);

  private baseId = `depgraph-${Math.random().toString(36).slice(2, 8)}`;
  private renderSeq = 0;
  private mutationObserver: MutationObserver | null = null;
  private mermaidTheme: 'dark' | 'default' = 'dark';

  ngAfterViewInit(): void {
    this.mermaidTheme =
      document.documentElement.getAttribute('data-theme') === 'light' ? 'default' : 'dark';

    this.mutationObserver = new MutationObserver(() => {
      this.mermaidTheme =
        document.documentElement.getAttribute('data-theme') === 'light' ? 'default' : 'dark';
      this.renderGraph();
    });
    this.mutationObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    this.loadGraph();
  }

  ngOnDestroy(): void {
    this.mutationObserver?.disconnect();
  }

  private loadGraph(): void {
    const repo = this.repository() as { id: number } | null;
    if (!repo) return;

    this.api.getDependencyGraph(repo.id).subscribe({
      next: (data) => {
        this.graph.set(data);
        this.loading.set(false);
        setTimeout(() => this.renderGraph(), 0);
      },
      error: (err: Error) => {
        this.error.set(err.message || 'No se pudo cargar el grafo de dependencias.');
        this.loading.set(false);
      },
    });
  }

  private async renderGraph(): Promise<void> {
    const g = this.graph();
    if (!g || !this.containerRef) return;

    const seq = ++this.renderSeq;
    const mmdSrc = graphToMermaid(g);
    if (!mmdSrc) return;

    this.mermaidService.initialize(this.mermaidTheme);

    try {
      const { svg } = await this.mermaidService.render(`${this.baseId}-svg`, mmdSrc);
      if (seq === this.renderSeq) {
        this.containerRef.nativeElement.innerHTML = svg;
      }
    } catch (err: unknown) {
      if (seq === this.renderSeq) {
        this.error.set(
          err instanceof Error ? err.message : 'Error al renderizar el grafo.'
        );
      }
    }
  }

  async handleCopyMermaid(): Promise<void> {
    const g = this.graph();
    if (!g) return;
    const src = graphToMermaid(g);
    if (!src) return;
    try {
      await navigator.clipboard.writeText(src);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1800);
    } catch { /* ignore */ }
  }

  onOverlayClick(): void {
    this.close.emit();
  }

  onModalClick(e: MouseEvent): void {
    e.stopPropagation();
  }
}
