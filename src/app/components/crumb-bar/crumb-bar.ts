import { ChangeDetectionStrategy, Component, ViewEncapsulation, inject } from '@angular/core';
import { ViewGraphStore } from '../../services/view-graph-store';

const DEPTH_OPTIONS = [1, 2, 3, 4, 6, 99];

@Component({
  selector: 'vg-crumb-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  templateUrl: './crumb-bar.html',
  styleUrl: './crumb-bar.css',
  host: { style: 'display: contents' },
})
export class CrumbBar {
  protected readonly store = inject(ViewGraphStore);
  protected readonly depthOptions = DEPTH_OPTIONS;

  protected onDepthChange(e: Event): void {
    const value = Number((e.target as HTMLSelectElement).value) || 2;
    this.store.setFocusDepth(value);
  }
}
