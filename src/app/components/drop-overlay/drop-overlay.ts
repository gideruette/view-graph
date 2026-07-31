import { ChangeDetectionStrategy, Component, ViewEncapsulation, inject } from '@angular/core';
import { ViewGraphStore } from '../../services/view-graph-store';

@Component({
  selector: 'vg-drop-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  templateUrl: './drop-overlay.html',
  styleUrl: './drop-overlay.css',
  host: { style: 'display: contents' },
})
export class DropOverlay {
  protected readonly store = inject(ViewGraphStore);
}
