import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, ViewEncapsulation, effect, inject, viewChild } from '@angular/core';
import type { PollutionScope } from '../../core/entry-pollution';
import { ViewGraphStore } from '../../services/view-graph-store';

/** Stack mix per entry point — which screens no single stack owns, and by how much. */
@Component({
  selector: 'vg-pollution-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [DecimalPipe],
  templateUrl: './pollution-dashboard.html',
  styleUrl: './pollution-dashboard.css',
})
export class PollutionDashboard {
  protected readonly store = inject(ViewGraphStore);
  private readonly closeBtn = viewChild<ElementRef<HTMLButtonElement>>('closeBtn');

  protected readonly scopes: { value: PollutionScope; label: string; title: string }[] = [
    { value: 'ui', label: 'UI units', title: 'Count components, views and layouts — the roles every UI stack has' },
    { value: 'all', label: 'Everything', title: 'Count every node carrying a type: tag, services and entities included' },
  ];

  constructor() {
    // Escape-to-close is handled by graph-canvas's document keydown guard, like the help dialog.
    effect(() => {
      if (this.store.pollutionOpen()) this.closeBtn()?.nativeElement.focus();
    });
  }

  protected onBackdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) this.store.closePollution();
  }

  /**
   * The track is a plain 0–100% scale, not rescaled to the worst row: two stacks cannot exceed 50%,
   * so a half-full bar reading as "as mixed as it gets" is the honest picture rather than a quirk.
   */
  protected barWidth(pollution: number | null): string {
    return `${pollution ?? 0}%`;
  }

  /** Bands for colour only — a tenth of a screen from another stack is a footnote, a quarter is not. */
  protected severity(pollution: number | null): string {
    if (pollution == null) return '';
    if (pollution === 0) return 'ok';
    if (pollution >= 25) return 'danger';
    if (pollution >= 10) return 'warn';
    return '';
  }
}
