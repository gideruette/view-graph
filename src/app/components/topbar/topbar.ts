import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { ViewGraphStore } from '../../services/view-graph-store';

@Component({
  selector: 'vg-topbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  templateUrl: './topbar.html',
  styleUrl: './topbar.css',
  host: { style: 'display: contents' },
})
export class Topbar {
  protected readonly store = inject(ViewGraphStore);

  private readonly searchInput = viewChild.required<ElementRef<HTMLInputElement>>('searchInput');
  private readonly filePicker = viewChild.required<ElementRef<HTMLInputElement>>('filePicker');
  private readonly addPicker = viewChild<ElementRef<HTMLInputElement>>('addPicker');

  protected readonly themeIcon = computed(() => {
    const t = this.store.theme();
    return t === 'light' ? '☀' : t === 'dark' ? '☾' : '◐';
  });
  protected readonly themeTitle = computed(
    () => `Theme: ${this.store.theme()} — click to cycle (auto → light → dark)`,
  );

  constructor() {
    // Cross-component focus request (see store.requestSearchFocus) — '/' shortcut lives in graph-canvas.
    let first = true;
    effect(() => {
      this.store.searchFocusToken();
      if (first) {
        first = false;
        return;
      }
      const el = this.searchInput().nativeElement;
      el.focus();
      el.select();
    });
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(e: MouseEvent): void {
    if (!this.store.searchResultsVisible()) return;
    const target = e.target as HTMLElement | null;
    if (!target?.closest?.('.search-wrap')) this.store.closeSearchResults();
  }

  protected onSearchInput(value: string): void {
    this.store.onSearchInput(value);
  }

  protected onSearchKeydown(e: KeyboardEvent): void {
    const input = e.target as HTMLInputElement;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.store.moveSearchCursor('down');
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.store.moveSearchCursor('up');
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      this.store.pickSearchResult();
      input.blur();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!this.store.query()) {
        input.blur();
        return;
      }
      this.store.clearQuery();
    }
  }

  protected onPickResult(id: string): void {
    this.store.pickSearchResult(id);
  }

  protected onSearchClear(): void {
    this.store.clearQuery();
    this.searchInput().nativeElement.focus();
  }

  protected onLoadClick(): void {
    this.filePicker().nativeElement.click();
  }

  protected onAddClick(): void {
    this.addPicker()?.nativeElement.click();
  }

  protected onFileChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (input.files?.length) this.store.readFiles(input.files, 'replace');
    input.value = '';
  }

  protected onAddFileChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (input.files?.length) this.store.readFiles(input.files, 'append');
    input.value = '';
  }
}
