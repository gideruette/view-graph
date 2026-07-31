import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnDestroy,
  ViewEncapsulation,
  effect,
  inject,
} from "@angular/core";
import { Banners } from "./components/banners/banners";
import { DetailPanel } from "./components/detail-panel/detail-panel";
import { DropOverlay } from "./components/drop-overlay/drop-overlay";
import { FilterBar } from "./components/filter-bar/filter-bar";
import { GraphCanvas } from "./components/graph-canvas/graph-canvas";
import { HelpDialog } from "./components/help-dialog/help-dialog";
import { NavPanel } from "./components/nav-panel/nav-panel";
import { StatusBar } from "./components/status-bar/status-bar";
import { Topbar } from "./components/topbar/topbar";
import { TreeView } from "./components/tree-view/tree-view";
import { isFileDrag } from "./core/utils";
import { ViewGraphStore } from "./services/view-graph-store";

@Component({
  selector: "vg-root",
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [
    DropOverlay,
    Topbar,
    FilterBar,
    Banners,
    NavPanel,
    GraphCanvas,
    TreeView,
    DetailPanel,
    StatusBar,
    HelpDialog,
  ],
  templateUrl: "./app.html",
  styleUrl: "./styles/view-graph.css",
  host: {
    class: "vg-app",
  },
})
export class App {
  protected readonly store = inject(ViewGraphStore);
  private dragging = false;

  constructor() {
    document.documentElement.classList.add("vg-active");

    effect(() => {
      const t = this.store.theme();
      if (t === "light" || t === "dark")
        document.documentElement.setAttribute("data-theme", t);
      else document.documentElement.removeAttribute("data-theme");
    });

    afterNextRender(() => this.store.bootstrap());
  }

  @HostListener("window:dragenter", ["$event"])
  protected onDragEnter(e: DragEvent): void {
    if (!isFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    this.dragging = true;
    this.store.dropOverlayVisible.set(true);
  }

  @HostListener("window:dragover", ["$event"])
  protected onDragOver(e: DragEvent): void {
    if (!isFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    try {
      e.dataTransfer!.dropEffect = "copy";
    } catch {
      /* ignore */
    }
  }

  @HostListener("window:dragleave", ["$event"])
  protected onDragLeave(e: DragEvent): void {
    if (e.relatedTarget != null) return;
    this.dragging = false;
    this.store.dropOverlayVisible.set(false);
  }

  @HostListener("window:drop", ["$event"])
  protected onWindowDrop(e: DragEvent): void {
    e.preventDefault();
    this.dragging = false;
    this.store.dropOverlayVisible.set(false);
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    this.store.readFiles(files);
  }

  @HostListener("window:dragend")
  protected onDragEnd(): void {
    this.dragging = false;
    this.store.dropOverlayVisible.set(false);
  }

  @HostListener("window:blur")
  protected onWindowBlur(): void {
    this.dragging = false;
    this.store.dropOverlayVisible.set(false);
  }

  @HostListener("window:keydown", ["$event"])
  protected onWindowKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape" && this.dragging) {
      this.dragging = false;
      this.store.dropOverlayVisible.set(false);
    }
  }
}
