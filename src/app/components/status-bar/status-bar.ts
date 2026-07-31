import { ChangeDetectionStrategy, Component, ViewEncapsulation, inject } from '@angular/core';
import { ViewGraphStore } from '../../services/view-graph-store';

@Component({
  selector: 'vg-status-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  templateUrl: './status-bar.html',
  styleUrl: './status-bar.css',
  host: { style: 'display: contents' },
})
export class StatusBar {
  protected readonly store = inject(ViewGraphStore);
}
