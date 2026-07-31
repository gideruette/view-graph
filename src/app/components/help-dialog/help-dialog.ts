import { ChangeDetectionStrategy, Component, ElementRef, ViewEncapsulation, effect, inject, viewChild } from '@angular/core';
import { DropZone } from '../drop-zone/drop-zone';
import { ViewGraphStore } from '../../services/view-graph-store';

@Component({
  selector: 'vg-help-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [DropZone],
  templateUrl: './help-dialog.html',
  styleUrl: './help-dialog.css',
})
export class HelpDialog {
  protected readonly store = inject(ViewGraphStore);
  private readonly closeBtn = viewChild<ElementRef<HTMLButtonElement>>('closeBtn');

  protected readonly keyboardShortcuts: [string, string][] = [
    ['/', 'focus search'],
    ['← → ↑ ↓', 'navigate nodes'],
    ['Enter', 'expand / collapse'],
    ['F', 'focus cone'],
    ['T', "restrict to this node's neighborhood"],
    ['H', 'hide / unhide this node'],
    ['G', 'toggle Layers / Clusters'],
    ['E', 'expand all'],
    ['C', 'collapse all'],
    ['Backspace', 'back'],
    ['Esc', 'clear selection / exit focus'],
    ['+ − 0', 'zoom in / out / fit'],
    ['?', 'this dialog'],
  ];

  protected readonly mouseShortcuts: [string, string][] = [
    ['click node', 'select'],
    ['dbl-click / ⊕', 'expand children'],
    ['dbl-click cluster', 'open community in Layers'],
    ['Alt + click', 'focus cone'],
    ['drag background', 'pan'],
    ['wheel', 'zoom'],
  ];

  constructor() {
    // Escape-to-close is handled globally by graph-canvas's document keydown guard.
    effect(() => {
      if (this.store.helpOpen()) this.closeBtn()?.nativeElement.focus();
    });
  }

  protected onBackdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) this.store.closeHelp();
  }
}
