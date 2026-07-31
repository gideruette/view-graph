import { ChangeDetectionStrategy, Component, ElementRef, ViewEncapsulation, inject, signal, viewChild } from '@angular/core';
import { ViewGraphStore } from '../../services/view-graph-store';

/** Reusable "drop view-graph.json / choose files" widget (stage overlay + help dialog). */
@Component({
  selector: 'vg-drop-zone',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  templateUrl: './drop-zone.html',
  host: { style: 'display: contents' },
})
export class DropZone {
  private readonly store = inject(ViewGraphStore);
  private readonly filePicker = viewChild.required<ElementRef<HTMLInputElement>>('filePicker');

  protected readonly over = signal(false);

  protected onChoose(): void {
    this.filePicker().nativeElement.click();
  }

  protected onFileChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (input.files?.length) this.store.readFiles(input.files);
    input.value = '';
  }

  protected onDragOver(e: DragEvent): void {
    e.preventDefault();
    this.over.set(true);
  }

  protected onDragLeave(): void {
    this.over.set(false);
  }

  protected onDrop(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this.over.set(false);
    const files = e.dataTransfer?.files;
    if (files?.length) this.store.readFiles(files);
  }
}
