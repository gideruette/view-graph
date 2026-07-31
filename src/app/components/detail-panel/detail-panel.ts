import { ChangeDetectionStrategy, Component, ViewEncapsulation, inject, signal } from '@angular/core';
import { ViewGraphStore } from '../../services/view-graph-store';

@Component({
  selector: 'vg-detail-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  templateUrl: './detail-panel.html',
  styleUrl: './detail-panel.css',
  host: { style: 'display: contents' },
})
export class DetailPanel {
  protected readonly store = inject(ViewGraphStore);

  /** Whether the inline "add a tag" input is showing (collapsed by default to keep the header calm). */
  protected readonly addingTag = signal(false);

  protected openTagInput(): void {
    this.addingTag.set(true);
  }

  protected commitTag(nodeId: string, input: HTMLInputElement): void {
    const value = input.value;
    input.value = '';
    if (!value.trim()) {
      this.addingTag.set(false);
      return;
    }
    this.store.addNodeTag(nodeId, value);
    /* stay open: tagging a node usually means tagging it with more than one thing */
  }

  protected cancelTag(input: HTMLInputElement): void {
    input.value = '';
    this.addingTag.set(false);
  }

  protected copy(value: string | null): void {
    if (!value) return;
    try {
      void navigator.clipboard.writeText(value);
    } catch {
      /* ignore */
    }
  }
}
