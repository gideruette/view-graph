import { ChangeDetectionStrategy, Component, ViewEncapsulation, inject } from '@angular/core';
import { CrumbBar } from '../crumb-bar/crumb-bar';
import { DropZone } from '../drop-zone/drop-zone';
import { NodeCard } from '../node-card/node-card';
import { TreeDir } from './tree-dir';
import { ViewGraphStore } from '../../services/view-graph-store';

/** Folder-tree rendering of Clusters mode's communities — cluster / directory / file, all foldable. */
@Component({
  selector: 'vg-tree-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [CrumbBar, DropZone, NodeCard, TreeDir],
  templateUrl: './tree-view.html',
  styleUrl: './tree-view.css',
  host: { style: 'display: contents' },
})
export class TreeView {
  protected readonly store = inject(ViewGraphStore);

  /** Chevron click toggles the cluster's own fold; anywhere else on the header selects it. */
  protected onHeaderClick(e: MouseEvent, id: string): void {
    const target = e.target as Element | null;
    if (target?.closest?.('.tv-chevron')) {
      this.store.toggleTreeFolder(id);
      return;
    }
    this.store.selectCluster(id);
  }

  protected onHeaderDblClick(e: MouseEvent, id: string): void {
    e.stopPropagation();
    this.store.openClusterInLayers(id);
  }
}
