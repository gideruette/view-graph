import { ChangeDetectionStrategy, Component, ViewEncapsulation, inject } from '@angular/core';
import { ViewGraphStore } from '../../services/view-graph-store';

@Component({
  selector: 'vg-banners',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  templateUrl: './banners.html',
  styleUrl: './banners.css',
  host: { style: 'display: contents' },
})
export class Banners {
  protected readonly store = inject(ViewGraphStore);
}
