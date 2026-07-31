import { ChangeDetectionStrategy, Component, ViewEncapsulation, inject } from '@angular/core';
import { ViewGraphStore } from '../../services/view-graph-store';

@Component({
  selector: 'vg-filter-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  templateUrl: './filter-bar.html',
  styleUrl: './filter-bar.css',
  host: { style: 'display: contents' },
})
export class FilterBar {
  protected readonly store = inject(ViewGraphStore);

  /** Spells out *why* nodes are off the canvas, so the count is never a dead end. */
  protected hiddenTitle(): string {
    const parts: string[] = [];
    const tags = this.store.activeHiddenTags();
    const manual = this.store.activeManualHidden().length;
    if (tags.length) parts.push(`hidden tags: ${tags.join(', ')}`);
    if (manual) parts.push(`${manual} node${manual > 1 ? 's' : ''} hidden by hand`);
    parts.push('open the Tags tab to change it');
    return parts.join(' — ');
  }

  protected mergeTitle(): string {
    const steps = this.store.effectiveClusterMergeSteps();
    const max = this.store.clusterMergeMax();
    if (!max) return 'No further inter-cluster links to merge';
    return `${steps} extra merge${steps === 1 ? '' : 's'} of ${max} — each front route keeps its own cluster at step 0 (back stack attached via API deps); each notch merges the next strongest remaining pair`;
  }

  protected onMergeSteps(ev: Event): void {
    const v = parseInt((ev.target as HTMLInputElement).value, 10);
    if (Number.isFinite(v)) this.store.setClusterMergeSteps(v);
  }
}
