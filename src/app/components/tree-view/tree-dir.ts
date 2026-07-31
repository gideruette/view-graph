import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, input } from '@angular/core';
import { NodeCard } from '../node-card/node-card';
import { ViewGraphStore } from '../../services/view-graph-store';
import type { TreeDirNode } from '../../core/tree-clusters';

/** One recursive folder row: chevron + name + count, expanding into sub-folders and node leaves. */
@Component({
  selector: 'vg-tree-dir',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [TreeDir, NodeCard],
  templateUrl: './tree-dir.html',
  styleUrl: './tree-dir.css',
  host: { style: 'display: block' },
})
export class TreeDir {
  private readonly store = inject(ViewGraphStore);

  readonly node = input.required<TreeDirNode>();

  protected readonly isOpen = computed(() => !this.store.treeCollapsedKeys().has(this.node().key));

  protected toggle(): void {
    this.store.toggleTreeFolder(this.node().key);
  }
}
