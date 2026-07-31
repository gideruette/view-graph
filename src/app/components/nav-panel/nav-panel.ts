import { ChangeDetectionStrategy, Component, ViewEncapsulation, inject } from '@angular/core';
import { NodeCard } from '../node-card/node-card';
import { ViewGraphStore } from '../../services/view-graph-store';

@Component({
  selector: 'vg-nav-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [NodeCard],
  templateUrl: './nav-panel.html',
  styleUrl: './nav-panel.css',
  host: { style: 'display: contents' },
})
export class NavPanel {
  protected readonly store = inject(ViewGraphStore);

  /**
   * Starting colour offered by the picker for a tag the user has not coloured yet — a spread of
   * distinguishable hues so two tags rarely open on the same one. Picking is still manual: this
   * value only pre-selects the swatch, it does not colour any node until the user commits.
   */
  protected suggestedColor(tag: string): string {
    let h = 0;
    for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) | 0;
    return SUGGESTED_COLORS[Math.abs(h) % SUGGESTED_COLORS.length];
  }

  protected onTagColor(tag: string, event: Event): void {
    const value = (event.target as HTMLInputElement | null)?.value;
    if (value) this.store.setTagColor(tag, value);
  }
}

const SUGGESTED_COLORS = [
  '#3457d5',
  '#0d9488',
  '#d97706',
  '#8b5cf6',
  '#e11d48',
  '#0891b2',
  '#65a30d',
  '#c026d3',
];
