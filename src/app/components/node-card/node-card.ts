import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, input } from '@angular/core';
import { ViewGraphStore } from '../../services/view-graph-store';

/** Presentational entry-point / orphan / neighbor row — reuses the `.ncard` styles from nav-panel.css. */
@Component({
  selector: 'vg-node-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  templateUrl: './node-card.html',
  host: { style: 'display: contents' },
})
export class NodeCard {
  private readonly store = inject(ViewGraphStore);

  readonly id = input.required<string>();
  /** nav-panel's "Entry points" tab restricts the graph to the clicked entry's subtree instead of just selecting it. */
  readonly entryClickSetsRoot = input(false);

  protected readonly vm = computed(() => this.store.nodeCardVm(this.id()));

  protected onClick(): void {
    const vm = this.vm();
    if (!vm) return;
    if (vm.isEntry && this.entryClickSetsRoot()) this.store.setEntryRoot(vm.id);
    else this.store.select(vm.id, { reveal: true, center: true });
  }
}
