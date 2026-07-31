import type { GraphNode } from '../core/graph-model';

export type ViewGraphTheme = 'auto' | 'light' | 'dark';
export type PanelSide = 'left' | 'right';
export type NavTab = 'entries' | 'orphans' | 'tags';
export type BannerKind = 'demo' | 'err' | 'info';
export type StageOverlayKind = 'empty' | 'error' | 'nothing';
/** Canvas layout mode: layered Sugiyama vs Louvain cluster regions. */
export type LayoutMode = 'layers' | 'clusters';
/** How Clusters mode renders its communities: hulls on the canvas, or a folder tree. */
export type ClusterDisplay = 'graph' | 'tree';

export interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

export interface Banner {
  id: number;
  kind: BannerKind;
  title: string;
  lines: string[];
  closable: boolean;
}

export interface HistoryEntry {
  focus: string | null;
  selected: string | null;
  entryRoot: string | null;
}

export interface StageOverlayState {
  kind: StageOverlayKind;
  detail?: string;
}

export interface CrumbItem {
  key: string;
  label: string;
  title: string;
  current: boolean;
  action: (() => void) | null;
}

export interface StatItem {
  label: string;
  value: number;
  alert?: boolean;
}

export interface NodeCardViewModel {
  id: string;
  name: string;
  sub: string;
  kindClass: string;
  isEntry: boolean;
  isCyclic: boolean;
  isOrphan: boolean;
  outCount: number;
  isSelected: boolean;
  /** Winning colour among this node's coloured tags, or null when none is coloured. */
  tagColor: string | null;
}

/** One row of the nav-panel "Tags" tab: bulk-hide toggle + bulk-colour swatch. */
export interface TagRow {
  tag: string;
  /** Portion after the first `:` (or the whole tag when unprefixed) — what the row displays. */
  label: string;
  count: number;
  hidden: boolean;
  color: string | null;
}

/** Tag rows grouped by namespace (`tech:`, `type:`, … — `other` for unprefixed tags). */
export interface TagGroup {
  name: string;
  rows: TagRow[];
}

export interface TagChip {
  tag: string;
  color: string | null;
  hidden: boolean;
  /** Hand-added by the user (removable) rather than emitted by the extractor (read-only). */
  manual: boolean;
}

export interface SearchResultItem {
  id: string;
  name: string;
  sub: string;
}

export interface DetailAction {
  key: string;
  label: string;
  title: string;
  primary: boolean;
  disabled: boolean;
}

export interface DetailNeighbor {
  id: string;
  name: string;
  meta: string;
  glyph: string;
}

export interface DetailViewModel {
  node: GraphNode;
  kindClass: string;
  isEntry: boolean;
  isOrphan: boolean;
  isCyclic: boolean;
  depthLabel: string;
  focusActionLabel: string;
  focusActionDisabled: boolean;
  restrictActionLabel: string;
  restrictActionDisabled: boolean;
  expandActionLabel: string;
  expandActionDisabled: boolean;
  incoming: DetailNeighbor[];
  outgoing: DetailNeighbor[];
  tags: TagChip[];
  /** Off the canvas for any reason — by tag, by hand, or because a hidden ancestor pruned it. */
  isHidden: boolean;
  /** Hidden by this node's own manual toggle (the only case the toggle can undo directly). */
  isManuallyHidden: boolean;
}

export interface GraphNodeVm {
  id: string;
  x: number;
  y: number;
  name: string;
  sub: string;
  kindClass: string;
  isEntry: boolean;
  isSelected: boolean;
  isKb: boolean;
  isHot: boolean;
  isMatch: boolean;
  isDim: boolean;
  isCyclic: boolean;
  isOrphan: boolean;
  childCount: number;
  isOpen: boolean;
  ariaLabel: string;
  /** Winning colour among this node's coloured tags, or null when none is coloured. */
  tagColor: string | null;
}

export interface GraphEdgeVm {
  key: string;
  d: string;
  isBack: boolean;
  isHot: boolean;
  isDim: boolean;
  title: string;
}

export interface ClusterHullVm {
  id: string;
  label: string;
  subtitle: string;
  path: string;
  labelX: number;
  labelY: number;
  colorIndex: number;
  isSelected: boolean;
  isDim: boolean;
  nodeCount: number;
}

export interface ClusterBridgeVm {
  key: string;
  d: string;
  weight: number;
  strokeWidth: number;
  isDim: boolean;
  title: string;
}
