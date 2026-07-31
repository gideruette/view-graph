import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Injector,
  ViewEncapsulation,
  afterNextRender,
  inject,
  viewChild,
  signal,
} from '@angular/core';
import { CrumbBar } from '../crumb-bar/crumb-bar';
import { DropZone } from '../drop-zone/drop-zone';
import { NODE_H, NODE_W } from '../../core/graph-layout';
import { FONT_NAME, FONT_SUB, fitText } from '../../core/text-fit';
import { plural } from '../../core/utils';
import { ViewGraphStore } from '../../services/view-graph-store';
import type { GraphNodeVm } from '../../models/view-graph.models';

interface NodeBadge {
  glyph: string;
  cls: string;
  title: string;
}

interface DragState {
  px: number;
  py: number;
  x: number;
  y: number;
  pointerId: number;
  moved: boolean;
}

@Component({
  selector: 'vg-graph-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [CrumbBar, DropZone],
  templateUrl: './graph-canvas.html',
  styleUrl: './graph-canvas.css',
  host: { style: 'display: contents' },
})
export class GraphCanvas {
  protected readonly store = inject(ViewGraphStore);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly NODE_W = NODE_W;
  protected readonly NODE_H = NODE_H;

  private readonly canvasWrap = viewChild.required<ElementRef<HTMLDivElement>>('canvasWrap');
  private readonly svgRoot = viewChild.required<ElementRef<SVGSVGElement>>('svgRoot');

  protected readonly panning = signal(false);
  private drag: DragState | null = null;

  constructor() {
    afterNextRender(() => {
      const el = this.canvasWrap().nativeElement;
      const measure = () => {
        const r = el.getBoundingClientRect();
        this.store.canvasRect.set({ width: r.width, height: r.height });
      };
      measure();
      this.store.fitToView();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      this.destroyRef.onDestroy(() => ro.disconnect());
    });
  }

  // --------------------------------------------------------------- rendering

  protected badges(n: GraphNodeVm): NodeBadge[] {
    const out: NodeBadge[] = [];
    if (n.isEntry) out.push({ glyph: '★', cls: 'entry', title: 'entry point' });
    if (n.isCyclic) out.push({ glyph: '↺', cls: 'cycle', title: 'part of a dependency cycle' });
    if (n.isOrphan) out.push({ glyph: '⌀', cls: 'orphan', title: 'not reachable from any entry point' });
    return out;
  }

  protected toggleTitle(n: GraphNodeVm): string {
    return `${n.isOpen ? 'Collapse' : 'Expand'} ${plural(n.childCount, 'dependency')}`;
  }

  protected fitTitle(n: GraphNodeVm): string {
    const badgeWidth = this.badges(n).length * 14;
    const maxW = Math.max(60, NODE_W - 9 - badgeWidth - 16);
    return fitText(n.name, FONT_NAME, maxW);
  }

  protected fitSub(n: GraphNodeVm): string {
    return fitText(n.sub, FONT_SUB, NODE_W - 26);
  }

  protected zoomLabel(): string {
    return `${Math.round(this.store.view().k * 100)}%`;
  }

  // ------------------------------------------------------------- node/edge UI

  protected onNodeClick(e: MouseEvent, id: string): void {
    e.stopPropagation();
    if (e.altKey) {
      this.store.setFocus(id);
      return;
    }
    this.store.select(id);
    if (this.store.layoutMode() === 'clusters') {
      const cid = this.store.clusterLayout()?.assignment.get(id) ?? null;
      this.store.selectCluster(cid);
    }
  }

  /** Prevent the SVG pan handler from capturing the gesture when it starts on a node. */
  protected onNodePointerDown(e: PointerEvent): void {
    e.stopPropagation();
  }

  protected onNodeDblClick(e: MouseEvent, id: string): void {
    e.stopPropagation();
    if (this.store.layoutMode() === 'clusters') {
      const cid = this.store.clusterLayout()?.assignment.get(id);
      if (cid) this.store.openClusterInLayers(cid);
      return;
    }
    this.store.toggleExpand(id);
  }

  protected onClusterClick(e: MouseEvent, id: string): void {
    e.stopPropagation();
    this.store.selectCluster(id);
    const hull = this.store.clusterLayout()?.clusters.find((c) => c.id === id);
    if (hull?.nodeIds.length) this.store.select(hull.nodeIds[0]);
  }

  protected onClusterDblClick(e: MouseEvent, id: string): void {
    e.stopPropagation();
    this.store.openClusterInLayers(id);
  }

  protected onToggleClick(e: MouseEvent, id: string): void {
    e.stopPropagation();
    this.store.toggleExpand(id);
  }

  protected onNodeFocus(id: string): void {
    this.store.kbNode.set(id);
  }

  // ------------------------------------------------------------------- legend

  protected onLegendToggle(e: Event): void {
    this.store.onLegendToggle((e.target as HTMLDetailsElement).open);
  }

  // --------------------------------------------------------------- pan / zoom

  protected onPointerDown(e: PointerEvent): void {
    const target = e.target as Element | null;
    /* Nodes and cluster labels keep their own click handlers; everywhere else pans —
       including empty space inside a cluster hull (hull fill is pointer-events: none). */
    if (target?.closest?.('.node') || target?.closest?.('.cluster-label')) return;
    if (e.button !== 0 && e.button !== 1) return;
    const v = this.store.view();
    this.drag = { px: e.clientX, py: e.clientY, x: v.x, y: v.y, pointerId: e.pointerId, moved: false };
    this.panning.set(true);
    try {
      this.svgRoot().nativeElement.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  protected onPointerMove(e: PointerEvent): void {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    const dx = e.clientX - this.drag.px;
    const dy = e.clientY - this.drag.py;
    if (Math.abs(dx) + Math.abs(dy) > 3) this.drag.moved = true;
    this.store.view.set({ x: this.drag.x + dx, y: this.drag.y + dy, k: this.store.view().k });
  }

  protected onPointerUp(e: PointerEvent): void {
    if (!this.drag) return;
    const wasMoved = this.drag.moved;
    const svg = this.svgRoot().nativeElement;
    try {
      svg.releasePointerCapture(this.drag.pointerId);
    } catch {
      /* ignore */
    }
    this.drag = null;
    this.panning.set(false);
    if (!wasMoved && e.target === svg) {
      this.store.clearSelection();
      this.store.selectCluster(null);
    }
  }

  protected onPointerCancel(): void {
    if (!this.drag) return;
    this.drag = null;
    this.panning.set(false);
  }

  protected onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.canvasWrap().nativeElement.getBoundingClientRect();
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.03 : 0.0016));
    this.store.zoomBy(factor, { x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  // ----------------------------------------------------------------- keyboard

  @HostListener('document:keydown', ['$event'])
  protected onDocumentKeydown(e: KeyboardEvent): void {
    if (this.store.helpOpen()) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.store.closeHelp();
      }
      return;
    }

    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    if (e.key === '/' && !typing) {
      e.preventDefault();
      this.store.requestSearchFocus();
      return;
    }
    if ((e.key === '?' || (e.key === '/' && e.shiftKey)) && !typing) {
      e.preventDefault();
      this.store.toggleHelp();
      return;
    }
    if (typing) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        this.moveKb('left');
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.moveKb('right');
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.moveKb('up');
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.moveKb('down');
        break;
      case 'Enter': {
        const kb = this.store.kbNode();
        if (kb) {
          e.preventDefault();
          this.store.toggleExpand(kb);
          this.focusAfterRender(kb);
        }
        break;
      }
      case 'f':
      case 'F': {
        const kb = this.store.kbNode();
        if (kb) {
          e.preventDefault();
          this.store.setFocus(kb);
        }
        break;
      }
      case 't':
      case 'T': {
        const kb = this.store.kbNode();
        if (kb) {
          e.preventDefault();
          this.store.setEntryRoot(kb);
        }
        break;
      }
      case 'h':
      case 'H': {
        const kb = this.store.kbNode() ?? this.store.selected();
        if (kb) {
          e.preventDefault();
          this.store.toggleNodeHidden(kb);
        }
        break;
      }
      case 'Backspace':
        e.preventDefault();
        this.store.goBack();
        break;
      case 'Escape':
        e.preventDefault();
        if (this.store.searchResultsVisible()) this.store.closeSearchResults();
        else if (this.store.selectedCluster()) this.store.selectCluster(null);
        else if (this.store.selected()) this.store.clearSelection();
        else if (this.store.focus()) this.store.clearFocus();
        else if (this.store.clusterScope()) this.store.clearClusterScope();
        else if (this.store.entryRoot()) this.store.clearEntryRoot();
        break;
      case 'g':
      case 'G':
        e.preventDefault();
        this.store.toggleLayoutMode();
        break;
      case '+':
      case '=':
        e.preventDefault();
        this.store.zoomBy(1.25);
        break;
      case '-':
      case '_':
        e.preventDefault();
        this.store.zoomBy(1 / 1.25);
        break;
      case '0':
        e.preventDefault();
        this.store.fitToView();
        break;
      case 'e':
      case 'E':
        e.preventDefault();
        this.store.expandAll();
        break;
      case 'c':
      case 'C':
        e.preventDefault();
        this.store.collapseAll();
        break;
    }
  }

  private moveKb(dir: 'left' | 'right' | 'up' | 'down'): void {
    const id = this.store.kbMove(dir);
    if (id) this.focusAfterRender(id);
  }

  /** Defers DOM focus until the signal-driven re-render that follows this event handler has committed. */
  private focusAfterRender(id: string): void {
    afterNextRender(
      () => {
        const svg = this.svgRoot().nativeElement;
        const escaped = CSS.escape(id);
        const g = svg.querySelector<SVGGElement>(`.node[data-nid="${escaped}"]`);
        try {
          g?.focus({ preventScroll: true });
        } catch {
          g?.focus();
        }
      },
      { injector: this.injector },
    );
  }
}
