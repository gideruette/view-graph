import { Injectable, computed, inject, signal } from '@angular/core';
import {
  type GraphData,
  type GraphIndex,
  buildGraphIndex,
  childCount,
  demoData,
  hiddenClosureFrom,
  inEdges,
  kindClass,
  normalizeGraph,
  nodeSub,
  orphanIds as computeOrphanIds,
  outEdges,
  pathFromEntries,
  subtreeOf,
} from '../core/graph-model';
import { type VisibilityState, computeVisibleGraph, layoutGraph, NODE_H, NODE_W } from '../core/graph-layout';
import { DEFAULT_CLUSTER_MERGE_STEPS, maxClusterMerges } from '../core/graph-clusters';
import { layoutClusteredGraph, type ClusterLayoutResult } from '../core/cluster-layout';
import { buildClusterTrees, collectDirKeys, type ClusterTree } from '../core/tree-clusters';
import { basename, edgeKey, plural } from '../core/utils';
import { safeStoreGet, safeStoreSet } from '../core/storage';
import { computeCenterOn, computeFit, computeZoom } from '../core/viewport';
import type {
  Banner,
  BannerKind,
  ClusterBridgeVm,
  ClusterDisplay,
  ClusterHullVm,
  CrumbItem,
  DetailNeighbor,
  DetailViewModel,
  GraphEdgeVm,
  GraphNodeVm,
  HistoryEntry,
  LayoutMode,
  NavTab,
  NodeCardViewModel,
  PanelSide,
  SearchResultItem,
  StageOverlayState,
  TagChip,
  TagGroup,
  TagRow,
  ViewGraphTheme,
  ViewTransform,
} from '../models/view-graph.models';
import { ViewGraphMergeService } from './view-graph-merge.service';

type LoadPhase = { kind: 'awaiting' | 'error'; detail?: string } | null;
type LoadMode = 'replace' | 'append';

/** Central signal-based state for the view-graph viewer (replaces the former imperative engine). */
@Injectable({ providedIn: 'root' })
export class ViewGraphStore {
  private readonly mergeService = inject(ViewGraphMergeService);

  // ---------------------------------------------------------------- raw data
  readonly data = signal<GraphData | null>(null);
  readonly source = signal('');
  readonly isDemo = signal(false);
  readonly validationWarnings = signal<string[]>([]);
  readonly sourceLabelText = signal('loading…');
  readonly sourceLabelTitle = signal('');
  /** Last successfully installed document (for append/merge). */
  private loadedRaw: unknown | null = null;
  private loadedFileNames: string[] = [];
  private readonly loadPhase = signal<LoadPhase>(null);

  readonly banners = signal<Banner[]>([]);
  private nextBannerId = 0;

  // --------------------------------------------------------- navigation/state
  readonly expanded = signal<ReadonlySet<string>>(new Set());
  readonly extraRoots = signal<ReadonlySet<string>>(new Set());
  readonly entryRoot = signal<string | null>(null);
  readonly focus = signal<string | null>(null);
  readonly focusDepth = signal(2);
  readonly history = signal<HistoryEntry[]>([]);
  readonly selected = signal<string | null>(null);
  readonly kbNode = signal<string | null>(null);
  readonly tab = signal<NavTab>('entries');
  readonly showOrphans = signal(false);

  // ----------------------------------------------------------- layout / clusters
  readonly layoutMode = signal<LayoutMode>('layers');
  /** How Clusters mode renders its communities: hulls on the canvas, or a folder tree. */
  readonly clusterDisplay = signal<ClusterDisplay>('graph');
  /** How many strongest inter-entry merges to apply (each slider notch = 1). */
  readonly clusterMergeSteps = signal(DEFAULT_CLUSTER_MERGE_STEPS);
  readonly selectedCluster = signal<string | null>(null);
  /** Folder keys collapsed in the Tree display — a key present means collapsed; everything else starts open. */
  readonly treeCollapsedKeys = signal<ReadonlySet<string>>(new Set());
  /**
   * When set (after "Open in layers" on a cluster), the visible graph is intersected
   * with these node ids so the layered view stays scoped to that community.
   */
  readonly clusterScope = signal<ReadonlySet<string> | null>(null);

  // -------------------------------------------------------------------- tags
  /** Tags whose nodes (and their exclusive subtrees) are pruned from the canvas. */
  readonly hiddenTags = signal<ReadonlySet<string>>(new Set());
  /** User-picked colour per tag. A tag with no entry here does not colour its nodes. */
  readonly tagColors = signal<ReadonlyMap<string, string>>(new Map());
  /** Nodes the user hid one by one, independently of any tag. */
  readonly manualHidden = signal<ReadonlySet<string>>(new Set());
  /** Tags the user added by hand, per node id — layered on top of what the extractor emitted. */
  readonly manualTags = signal<ReadonlyMap<string, string[]>>(new Map());

  // ------------------------------------------------------------------ search
  readonly query = signal('');
  readonly srIndex = signal(-1);
  private readonly resultsClosed = signal(false);
  /** Bumped to ask the topbar to focus/select the search input (cross-component, see Topbar). */
  readonly searchFocusToken = signal(0);

  // ---------------------------------------------------------------- viewport
  readonly view = signal<ViewTransform>({ x: 0, y: 0, k: 1 });
  readonly canvasRect = signal<{ width: number; height: number }>({ width: 0, height: 0 });

  // ------------------------------------------------------------------- chrome
  readonly theme = signal<ViewGraphTheme>('auto');
  readonly legendOpen = signal(false);
  readonly helpOpen = signal(false);
  readonly dropOverlayVisible = signal(false);

  constructor() {
    const storedTheme = safeStoreGet('vg-theme');
    if (storedTheme === 'light' || storedTheme === 'dark') this.theme.set(storedTheme);
    this.legendOpen.set(safeStoreGet('vg-legend') === 'open');
    const mode = safeStoreGet('vg-layout-mode');
    if (mode === 'layers' || mode === 'clusters') this.layoutMode.set(mode);
    const display = safeStoreGet('vg-cluster-display');
    if (display === 'graph' || display === 'tree') this.clusterDisplay.set(display);
    const steps = parseInt(safeStoreGet('vg-cluster-merges') ?? '', 10);
    if (Number.isFinite(steps) && steps >= 0) this.clusterMergeSteps.set(steps);
    this.restoreTagPrefs();
  }

  // =========================================================== derived state

  /** True when a real extract is loaded (Add JSON is available). */
  readonly canAppendJson = computed(() => !!this.data() && !this.isDemo());

  readonly index = computed<GraphIndex | null>(() => {
    const d = this.data();
    return d ? buildGraphIndex(d) : null;
  });

  /**
   * Effective tags per node: what the extractor emitted plus what the user added by hand. Every
   * tag-driven feature reads this, so a hand-added tag hides and colours exactly like an emitted one.
   */
  readonly nodeTags = computed<ReadonlyMap<string, string[]>>(() => {
    const d = this.data();
    const out = new Map<string, string[]>();
    if (!d) return out;
    const manual = this.manualTags();
    d.nodes.forEach((n) => {
      const extra = manual.get(n.id);
      out.set(n.id, extra?.length ? [...new Set([...n.tags, ...extra])] : n.tags);
    });
    return out;
  });

  tagsOf(id: string): string[] {
    return this.nodeTags().get(id) ?? [];
  }

  /** Every tag the loaded graph carries → node count, sorted by tag name. */
  readonly tagCountsByTag = computed<ReadonlyMap<string, number>>(() => {
    const counts = new Map<string, number>();
    this.nodeTags().forEach((tags) => tags.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
    return new Map([...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  });

  readonly hasTags = computed(() => this.tagCountsByTag().size > 0);

  /** Tags that are hidden *and* actually present in the loaded graph. */
  readonly activeHiddenTags = computed<string[]>(() => {
    const present = this.tagCountsByTag();
    return [...this.hiddenTags()].filter((t) => present.has(t)).sort((a, b) => a.localeCompare(b));
  });

  /** Nodes the user hid one by one that actually exist in the loaded graph. */
  readonly activeManualHidden = computed<string[]>(() => {
    const d = this.data();
    if (!d) return [];
    return [...this.manualHidden()].filter((id) => d.byId.has(id));
  });

  /**
   * Everything the filters take off the canvas: nodes hidden by tag or by hand, plus the
   * descendants only they reached. Both sources feed one closure so a mixed selection prunes
   * branches the same way a pure tag filter does.
   */
  readonly hiddenNodeIds = computed<ReadonlySet<string>>(() => {
    const d = this.data();
    const idx = this.index();
    if (!d || !idx) return new Set<string>();
    const hiddenTags = this.hiddenTags();
    const seeds = new Set<string>(this.activeManualHidden());
    if (hiddenTags.size) {
      this.nodeTags().forEach((tags, id) => {
        if (tags.some((t) => hiddenTags.has(t))) seeds.add(id);
      });
    }
    return hiddenClosureFrom(d, idx, seeds);
  });

  readonly anyHidden = computed(() => this.hiddenNodeIds().size > 0);

  readonly tagRows = computed<TagRow[]>(() => {
    const hidden = this.hiddenTags();
    const colors = this.tagColors();
    return [...this.tagCountsByTag().entries()].map(([tag, count]) => ({
      tag,
      label: tag.includes(':') ? tag.slice(tag.indexOf(':') + 1) : tag,
      count,
      hidden: hidden.has(tag),
      color: colors.get(tag) ?? null,
    }));
  });

  readonly tagGroups = computed<TagGroup[]>(() => {
    const groups = new Map<string, TagRow[]>();
    this.tagRows().forEach((row) => {
      const ns = row.tag.includes(':') ? row.tag.slice(0, row.tag.indexOf(':')) : 'other';
      if (!groups.has(ns)) groups.set(ns, []);
      groups.get(ns)!.push(row);
    });
    return [...groups.entries()]
      .sort((a, b) => (a[0] === 'other' ? 1 : b[0] === 'other' ? -1 : a[0].localeCompare(b[0])))
      .map(([name, rows]) => ({ name, rows }));
  });

  readonly visible = computed(() => {
    const d = this.data();
    const idx = this.index();
    if (!d || !idx) return null;
    const state: VisibilityState = {
      focus: this.focus(),
      focusDepth: this.focusDepth(),
      entryRoot: this.entryRoot(),
      expanded: this.expanded(),
      extraRoots: this.extraRoots(),
      showOrphans: this.showOrphans(),
      hidden: this.hiddenNodeIds(),
    };
    const v = computeVisibleGraph(d, idx, state);
    const scope = this.clusterScope();
    if (!scope || this.layoutMode() === 'clusters') return v;
    const nodes = new Set<string>();
    v.nodes.forEach((id) => {
      if (scope.has(id)) nodes.add(id);
    });
    const edges = v.edges.filter((e) => nodes.has(e.source) && nodes.has(e.target));
    const roots = v.roots.filter((id) => nodes.has(id));
    const rootFallback = roots.length ? roots : [...nodes].slice(0, 1);
    return { roots: rootFallback, nodes, edges };
  });

  readonly layout = computed(() => {
    const v = this.visible();
    const idx = this.index();
    const d = this.data();
    if (!v || !idx || !d) return null;
    if (this.layoutMode() === 'clusters') {
      return layoutClusteredGraph(v, idx, d, this.nodeTags(), this.effectiveClusterMergeSteps());
    }
    return layoutGraph(v, idx);
  });

  readonly clusterLayout = computed<ClusterLayoutResult | null>(() => {
    const L = this.layout();
    if (!L || this.layoutMode() !== 'clusters') return null;
    return L as ClusterLayoutResult;
  });

  /** Clusters mode's communities rendered as folder trees instead of canvas hulls. */
  readonly clusterTrees = computed<ClusterTree[]>(() => {
    if (this.layoutMode() !== 'clusters' || this.clusterDisplay() !== 'tree') return [];
    const cl = this.clusterLayout();
    const d = this.data();
    if (!cl || !d) return [];
    return buildClusterTrees(cl.communities, d);
  });

  readonly clusterMergeMax = computed(() => {
    const v = this.visible();
    const idx = this.index();
    const d = this.data();
    if (!v || !idx || !d) return 0;
    return maxClusterMerges(v, idx, d);
  });

  /** Slider position clamped to what the current visible graph allows. */
  readonly effectiveClusterMergeSteps = computed(() =>
    Math.max(0, Math.min(this.clusterMergeSteps(), this.clusterMergeMax())),
  );

  readonly orphanIds = computed<string[]>(() => {
    const d = this.data();
    const idx = this.index();
    return d && idx ? computeOrphanIds(d, idx) : [];
  });

  readonly canGoBack = computed(() => this.history().length > 0);

  readonly stageOverlay = computed<StageOverlayState | null>(() => {
    if (!this.data()) {
      const lp = this.loadPhase();
      if (!lp) return null;
      return { kind: lp.kind === 'error' ? 'error' : 'empty', detail: lp.detail };
    }
    const v = this.visible();
    if (v && v.nodes.size === 0) {
      const tags = this.activeHiddenTags();
      const manual = this.activeManualHidden().length;
      let detail: string | undefined;
      if (tags.length) detail = `The tag filter is hiding everything (${tags.join(', ')}).`;
      else if (manual) detail = `${plural(manual, 'hidden node')} is hiding everything still on screen.`;
      return { kind: 'nothing', detail };
    }
    return null;
  });

  readonly searchResultIds = computed<string[]>(() => {
    const d = this.data();
    const q = this.query().trim().toLowerCase();
    if (!d || !q) return [];
    const out: string[] = [];
    d.nodes.forEach((n) => {
      const hay = `${n.name} ${n.id} ${n.file ?? ''} ${n.kind ?? ''}`.toLowerCase();
      if (hay.indexOf(q) >= 0) out.push(n.id);
    });
    return out;
  });

  readonly matches = computed<Set<string>>(() => new Set(this.searchResultIds()));

  readonly searchResults = computed<SearchResultItem[]>(() => {
    const d = this.data();
    if (!d) return [];
    return this.searchResultIds()
      .slice(0, 40)
      .map((id) => {
        const n = d.byId.get(id)!;
        return { id, name: n.name, sub: nodeSub(n) };
      });
  });

  readonly searchResultsVisible = computed(
    () => !this.resultsClosed() && this.query().trim().length > 0 && this.searchResultIds().length > 0,
  );

  readonly crumbs = computed<CrumbItem[]>(() => {
    const items: CrumbItem[] = [];
    const entryRoot = this.entryRoot();
    const focus = this.focus();
    const scope = this.clusterScope();
    items.push({
      key: 'all',
      label: 'All entry points',
      title: 'Back to entry-point landing view',
      current: !entryRoot && !focus && !scope,
      action: () => this.clearEntryRoot(),
    });
    if (scope && this.layoutMode() === 'layers') {
      items.push({
        key: 'cluster-scope',
        label: `Cluster (${scope.size})`,
        title: 'Layered view scoped to one community — click to clear',
        current: !focus,
        action: () => this.clearClusterScope(),
      });
    }
    if (entryRoot) {
      items.push({
        key: entryRoot,
        label: this.nodeName(entryRoot),
        title: "Ancestors + descendants of this node",
        current: !focus,
        action: () => this.clearFocus(false),
      });
    }
    if (focus) {
      items.push({ key: focus, label: this.nodeName(focus), title: 'Focus cone', current: true, action: null });
    }
    return items;
  });

  readonly stats = computed(() => {
    const d = this.data();
    if (!d) return [];
    const st = d.stats;
    return [
      { label: 'nodes', value: st.nodeCount },
      { label: 'edges', value: st.edgeCount },
      { label: 'entries', value: st.entryPointCount },
      { label: 'orphans', value: st.orphanCount, alert: st.orphanCount > 0 },
      { label: 'depth', value: st.maxDepth },
    ];
  });

  readonly statusText = computed(() => {
    const d = this.data();
    const v = this.visible();
    const L = this.layout();
    if (!d || !v || !L) return 'Ready';
    const parts: string[] = [];
    parts.push(`${v.nodes.size}/${d.nodes.length} nodes`);
    parts.push(`${v.edges.length} edges`);
    if (this.layoutMode() === 'clusters') {
      const cl = this.clusterLayout();
      parts.push(`${cl?.clusters.length ?? 0} clusters`);
    } else {
      parts.push(`${L.layers.length} layers`);
    }
    const focus = this.focus();
    const entryRoot = this.entryRoot();
    if (focus) parts.push(`focus: ${this.nodeName(focus)}`);
    else if (entryRoot) parts.push(`restrict: ${this.nodeName(entryRoot)}`);
    if (this.clusterScope() && this.layoutMode() === 'layers') parts.push('cluster scope');
    const q = this.query();
    if (q) parts.push(`${this.matches().size} matches for "${q}"`);
    const hiddenCount = this.hiddenNodeIds().size;
    if (hiddenCount) {
      const by: string[] = [];
      if (this.activeHiddenTags().length) by.push(plural(this.activeHiddenTags().length, 'tag'));
      if (this.activeManualHidden().length) by.push('manual');
      parts.push(`${hiddenCount} hidden${by.length ? ` by ${by.join(' + ')}` : ''}`);
    }
    return parts.join('  ·  ');
  });

  readonly leftPanelEntries = computed<string[]>(() => this.data()?.entryPoints ?? []);
  readonly leftPanelOrphans = computed<string[]>(() => this.orphanIds());

  readonly detail = computed<DetailViewModel | null>(() => {
    const id = this.selected();
    const d = this.data();
    const idx = this.index();
    if (!id || !d || !idx) return null;
    const n = d.byId.get(id);
    if (!n) return null;
    const isEntry = d.entryPoints.includes(id);
    const focus = this.focus();
    const entryRoot = this.entryRoot();
    const cc = this.visibleChildCount(id);
    const hiddenTags = this.hiddenTags();
    const colors = this.tagColors();
    return {
      node: n,
      kindClass: kindClass(n.kind),
      isEntry,
      isOrphan: !idx.reach.has(id),
      isCyclic: idx.cyclicNodes.has(id),
      depthLabel: idx.depth.has(id) ? String(idx.depth.get(id)) : '—',
      focusActionLabel: focus === id ? 'Focused' : 'Focus',
      focusActionDisabled: focus === id,
      restrictActionLabel: entryRoot === id ? 'Scoped' : 'Restrict',
      restrictActionDisabled: entryRoot === id,
      expandActionLabel: this.expanded().has(id) ? 'Collapse' : 'Expand',
      expandActionDisabled: !cc,
      incoming: inEdges(idx, id).map((e) => this.neighborVm(e.source, '←')),
      outgoing: outEdges(idx, id).map((e) => this.neighborVm(e.target, '→')),
      isHidden: this.hiddenNodeIds().has(id),
      isManuallyHidden: this.manualHidden().has(id),
      tags: this.tagsOf(id).map<TagChip>((t) => ({
        tag: t,
        color: colors.get(t) ?? null,
        hidden: hiddenTags.has(t),
        // only hand-added tags are removable — the extract itself is read-only
        manual: !n.tags.includes(t),
      })),
    };
  });

  private neighborVm(id: string, glyph: string): DetailNeighbor {
    const n = this.data()?.byId.get(id);
    return { id, name: n ? n.name : id, meta: n ? n.kind || basename(n.file) || '' : '', glyph };
  }

  readonly dimming = computed(() => this.query().trim().length > 0 && this.matches().size > 0);

  private readonly hotNodes = computed<Set<string>>(() => {
    const sel = this.selected();
    const idx = this.index();
    const out = new Set<string>();
    if (sel && idx) {
      inEdges(idx, sel).forEach((e) => out.add(e.source));
      outEdges(idx, sel).forEach((e) => out.add(e.target));
    }
    return out;
  });

  private readonly hotEdgeKeys = computed<Set<string>>(() => {
    const sel = this.selected();
    const idx = this.index();
    const out = new Set<string>();
    if (sel && idx) {
      inEdges(idx, sel).forEach((e) => out.add(edgeKey(e)));
      outEdges(idx, sel).forEach((e) => out.add(edgeKey(e)));
    }
    return out;
  });

  readonly graphNodes = computed<GraphNodeVm[]>(() => {
    const L = this.layout();
    const v = this.visible();
    const d = this.data();
    const idx = this.index();
    if (!L || !v || !d || !idx) return [];
    const hot = this.hotNodes();
    const dim = this.dimming();
    const matches = this.matches();
    const selected = this.selected();
    const kb = this.kbNode();
    const selectedCluster = this.selectedCluster();
    const clusterMembers =
      selectedCluster && this.clusterLayout()
        ? new Set(this.clusterLayout()!.clusters.find((c) => c.id === selectedCluster)?.nodeIds ?? [])
        : null;
    const out: GraphNodeVm[] = [];
    v.nodes.forEach((id) => {
      const p = L.nodes.get(id);
      const n = d.byId.get(id);
      if (!p || !n) return;
      const outsideCluster = !!clusterMembers && !clusterMembers.has(id);
      out.push({
        id,
        x: p.x,
        y: p.y,
        name: n.name,
        sub: nodeSub(n),
        kindClass: kindClass(n.kind),
        isEntry: d.entryPoints.includes(id),
        isSelected: selected === id,
        isKb: kb === id,
        isHot: hot.has(id),
        isMatch: matches.has(id),
        isDim: (dim && !matches.has(id)) || outsideCluster,
        isCyclic: idx.cyclicNodes.has(id),
        isOrphan: !idx.reach.has(id),
        childCount: this.visibleChildCount(id),
        isOpen: outEdges(idx, id).some((e) => v.nodes.has(e.target)),
        ariaLabel: `${n.name}${n.kind ? `, ${n.kind}` : ''}${d.entryPoints.includes(id) ? ', entry point' : ''}`,
        tagColor: this.tagColorFor(this.tagsOf(id)),
      });
    });
    return out;
  });

  readonly graphEdges = computed<GraphEdgeVm[]>(() => {
    const L = this.layout();
    if (!L) return [];
    const hotE = this.hotEdgeKeys();
    const dim = this.dimming();
    return L.edges.map((g) => ({
      key: g.key,
      d: g.d,
      isBack: g.isBack,
      isHot: hotE.has(g.key),
      isDim: dim && !hotE.has(g.key),
      title: `${this.nodeName(g.e.source)} depends on ${this.nodeName(g.e.target)}`,
    }));
  });

  readonly clusterHulls = computed<ClusterHullVm[]>(() => {
    const cl = this.clusterLayout();
    if (!cl) return [];
    const selected = this.selectedCluster();
    const dim = this.dimming();
    const matches = this.matches();
    return cl.clusters.map((h) => {
      const hasMatch = h.nodeIds.some((id) => matches.has(id));
      return {
        id: h.id,
        label: h.label,
        subtitle: h.subtitle,
        path: h.path,
        labelX: h.labelX,
        labelY: h.labelY,
        colorIndex: h.colorIndex,
        isSelected: selected === h.id,
        isDim: dim && !hasMatch,
        nodeCount: h.nodeIds.length,
      };
    });
  });

  readonly clusterBridges = computed<ClusterBridgeVm[]>(() => {
    const cl = this.clusterLayout();
    if (!cl) return [];
    const dim = this.dimming();
    const maxW = Math.max(1, ...cl.clusterBridges.map((b) => b.weight));
    return cl.clusterBridges.map((b) => ({
      key: b.key,
      d: b.d,
      weight: b.weight,
      strokeWidth: 1.4 + (2.6 * b.weight) / maxW,
      isDim: dim,
      title: `${b.weight} dependenc${b.weight === 1 ? 'y' : 'ies'} between clusters`,
    }));
  });

  nodeName(id: string): string {
    return this.data()?.byId.get(id)?.name ?? id;
  }

  nodeCardVm(id: string): NodeCardViewModel | null {
    const d = this.data();
    const idx = this.index();
    if (!d || !idx) return null;
    const n = d.byId.get(id);
    if (!n) return null;
    return {
      id,
      name: n.name,
      sub: nodeSub(n),
      kindClass: kindClass(n.kind),
      isEntry: d.entryPoints.includes(id),
      isCyclic: idx.cyclicNodes.has(id),
      isOrphan: !idx.reach.has(id),
      outCount: this.visibleChildCount(id),
      isSelected: this.selected() === id,
      tagColor: this.tagColorFor(this.tagsOf(id)),
    };
  }

  /**
   * Outgoing dependencies that the tag filter still lets through — what the expand toggle would
   * actually reveal. Counting them all would show a "3" badge that opens nothing.
   */
  private visibleChildCount(id: string): number {
    const idx = this.index();
    if (!idx) return 0;
    const hidden = this.hiddenNodeIds();
    if (!hidden.size) return childCount(idx, id);
    return outEdges(idx, id).filter((e) => !hidden.has(e.target)).length;
  }

  /**
   * Winning colour among a node's coloured tags. A node can carry several coloured tags; the
   * alphabetically first one wins so the canvas stays stable and the rule stays explainable.
   */
  private tagColorFor(tags: string[]): string | null {
    const colors = this.tagColors();
    if (!colors.size) return null;
    let winner: string | null = null;
    let winnerTag = '';
    for (const t of tags) {
      const c = colors.get(t);
      if (!c) continue;
      if (winner === null || t.localeCompare(winnerTag) < 0) {
        winner = c;
        winnerTag = t;
      }
    }
    return winner;
  }

  // ================================================================ loading

  bootstrap(defaultJsonUrl?: string | null): void {
    const url = new URLSearchParams(location.search).get('data') || defaultJsonUrl || null;
    if (!url) {
      this.awaitUpload();
      return;
    }
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      this.fail(`Timed out fetching "${url}".`);
      this.awaitUpload('Could not fetch the extract URL. Upload a file instead.');
    }, 8000);
    fetch(url, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
        return r.text();
      })
      .then((txt) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        let parsed: unknown;
        try {
          parsed = JSON.parse(txt);
        } catch (err) {
          this.fail(`"${url}" is not valid JSON: ${(err as Error).message}`);
          this.awaitUpload();
          return;
        }
        if (!this.install(parsed, `url: ${url}`, { fileNames: [url], raw: parsed })) this.awaitUpload();
      })
      .catch((err: unknown) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.fail(`Could not fetch "${url}".`, [String((err as Error)?.message ?? err)]);
        this.awaitUpload('Upload a view-graph.json extract to explore it.');
      });
  }

  loadDemo(): void {
    this.install(demoData(), 'built-in demo dataset');
  }

  /** Drop / file pick default: append when a real graph is loaded, else replace. */
  preferredLoadMode(): LoadMode {
    return this.canAppendJson() ? 'append' : 'replace';
  }

  readFile(file: File, mode?: LoadMode): void {
    void this.readFiles([file], mode);
  }

  readFiles(files: Iterable<File>, mode: LoadMode = this.preferredLoadMode()): void {
    this.dropOverlayVisible.set(false);
    const list = [...files];
    const jsonFiles = list.filter((f) => /\.json$/i.test(f.name));
    const skipped = list.filter((f) => !/\.json$/i.test(f.name)).map((f) => f.name);
    if (!jsonFiles.length) {
      const first = list[0];
      this.fail(first ? `"${first.name}" is not a .json file.` : 'No JSON file selected.');
      return;
    }

    void Promise.all(jsonFiles.map((f) => this.readFileAsJson(f)))
      .then((parsed) => {
        this.ingestParsed(parsed, mode);
        if (skipped.length) {
          this.addBanner('info', `Skipped non-JSON file${skipped.length > 1 ? 's' : ''}.`, skipped, true);
        }
      })
      .catch((err: unknown) => {
        this.fail(String((err as Error)?.message ?? err));
      });
  }

  private readFileAsJson(file: File): Promise<{ name: string; raw: unknown }> {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error(`Could not read "${file.name}".`));
      fr.onload = () => {
        try {
          resolve({ name: file.name, raw: JSON.parse(String(fr.result ?? '')) });
        } catch (err) {
          reject(new Error(`"${file.name}" is not valid JSON: ${(err as Error).message}`));
        }
      };
      fr.readAsText(file);
    });
  }

  private ingestParsed(incoming: Array<{ name: string; raw: unknown }>, mode: LoadMode): void {
    if (!incoming.length) return;

    const append = mode === 'append' && this.loadedRaw != null && !this.isDemo();
    const docs = append ? [this.loadedRaw!, ...incoming.map((i) => i.raw)] : incoming.map((i) => i.raw);
    const names = append ? [...this.loadedFileNames, ...incoming.map((i) => i.name)] : incoming.map((i) => i.name);

    if (docs.length === 1) {
      this.install(docs[0], `file: ${names[0]}`, { fileNames: names, raw: docs[0] });
      return;
    }

    try {
      const { document } = this.mergeService.mergeAll(docs);
      const label =
        names.length <= 3 ? `merged: ${names.join(', ')}` : `merged: ${names.length} files (${names[0]} + …)`;
      this.install(document, label, { fileNames: names, raw: document });
    } catch (err) {
      this.fail(`Could not merge extracts: ${(err as Error).message}`);
    }
  }

  private awaitUpload(detail?: string): void {
    this.loadedRaw = null;
    this.loadedFileNames = [];
    this.source.set('no data');
    this.sourceLabelText.set('upload an extract…');
    this.sourceLabelTitle.set('Drop view-graph.json file(s) or use Load JSON…');
    this.loadPhase.set({ kind: 'awaiting', detail });
  }

  fail(msg: string, extra: string[] = []): void {
    this.clearBanners();
    this.addBanner('err', msg, extra, true);
    if (!this.data()) {
      this.source.set('no data');
      this.sourceLabelText.set('no data loaded');
      this.sourceLabelTitle.set('');
      this.loadPhase.set({ kind: 'error', detail: msg });
    }
  }

  install(
    raw: unknown,
    source: string,
    opts?: { fileNames?: string[]; raw?: unknown },
  ): boolean {
    const res = normalizeGraph(raw);
    this.clearBanners();
    if (!res.data) {
      this.fail('This file does not match SCHEMA.md v4.', [...res.errors, ...res.warnings]);
      return false;
    }
    this.data.set(res.data);
    this.validationWarnings.set(res.warnings);
    this.source.set(source || '');
    const isDemo = /^built-in demo/i.test(source || '');
    this.isDemo.set(isDemo);
    this.loadedRaw = isDemo ? null : (opts?.raw ?? raw);
    this.loadedFileNames = isDemo ? [] : (opts?.fileNames ?? this.loadedFileNames);
    this.expanded.set(new Set());
    this.extraRoots.set(new Set());
    this.focus.set(null);
    this.entryRoot.set(null);
    this.selected.set(null);
    this.kbNode.set(null);
    this.history.set([]);
    this.selectedCluster.set(null);
    this.clusterScope.set(null);
    this.tab.set('entries');

    const meta = res.data.meta;
    const label = meta.label || meta.tech || '';
    this.sourceLabelText.set(`${label ? `${label} · ` : ''}${source} · v4 · ${res.data.nodes.length} nodes`);
    this.sourceLabelTitle.set(
      [
        meta.tech ? `tech: ${meta.tech}` : '',
        meta.label ? `label: ${meta.label}` : '',
        meta.root ? `root: ${meta.root}` : '',
        this.loadedFileNames.length ? `files: ${this.loadedFileNames.join(', ')}` : '',
        source,
        res.data.generatedAt ? `generated ${res.data.generatedAt}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );

    this.loadPhase.set(null);
    this.dropOverlayVisible.set(false);

    if (isDemo) {
      this.addBanner(
        'demo',
        'Showing the built-in DEMO dataset — this is not your project.',
        ['Drop your view-graph.json or use Load JSON… to explore a real extract.'],
        true,
      );
    }
    if (res.warnings.length) {
      this.addBanner(
        'info',
        `${plural(res.warnings.length, 'schema warning')} — data repaired where possible.`,
        res.warnings,
        true,
      );
    } else if (meta.warnings.length && !isDemo) {
      const from = meta.tech === 'merged' ? 'merge' : 'the extractor';
      this.addBanner('info', `${plural(meta.warnings.length, 'warning')} from ${from}.`, meta.warnings, true);
    }

    this.fitToView();
    return true;
  }

  // ================================================================ banners

  addBanner(kind: BannerKind, title: string, lines: string[] = [], closable = false): number {
    const id = this.nextBannerId++;
    this.banners.update((b) => [...b, { id, kind, title, lines: lines.slice(0, 12), closable }]);
    return id;
  }

  dismissBanner(id: number): void {
    this.banners.update((b) => b.filter((x) => x.id !== id));
  }

  private clearBanners(): void {
    this.banners.set([]);
  }

  // ============================================================== selection

  select(id: string, opts?: { reveal?: boolean; center?: boolean }): void {
    this.selected.set(id);
    this.kbNode.set(id);
    if (opts?.reveal) this.reveal(id);
    if (opts?.center) this.centerOn(id);
  }

  clearSelection(): void {
    this.selected.set(null);
  }

  reveal(id: string): void {
    const d = this.data();
    const idx = this.index();
    if (!d || !idx) return;
    const p = pathFromEntries(d, idx, this.entryRoot(), id);
    if (p) {
      const next = new Set(this.expanded());
      for (let i = 0; i < p.length - 1; i++) next.add(p[i]);
      this.expanded.set(next);
    } else {
      const next = new Set(this.extraRoots());
      next.add(id);
      this.extraRoots.set(next);
    }
  }

  centerAndReveal(id: string): void {
    this.reveal(id);
    this.centerOn(id);
  }

  private pushHistory(): void {
    this.history.update((h) => [...h, { focus: this.focus(), selected: this.selected(), entryRoot: this.entryRoot() }]);
  }

  setFocus(id: string): void {
    if (this.focus() !== id) this.pushHistory();
    this.focus.set(id);
    this.selected.set(id);
    this.kbNode.set(id);
    this.fitToView();
  }

  clearFocus(recordHistory = true): void {
    if (!this.focus()) return;
    if (recordHistory) this.pushHistory();
    this.focus.set(null);
    this.fitToView();
  }

  setEntryRoot(id: string): void {
    const d = this.data();
    if (!d || !d.byId.has(id)) return;
    if (this.entryRoot() !== id || this.focus()) this.pushHistory();
    this.entryRoot.set(id);
    this.focus.set(null);
    this.selected.set(id);
    this.kbNode.set(id);
    this.expanded.set(new Set([id]));
    this.extraRoots.set(new Set());
    this.fitToView();
  }

  clearEntryRoot(): void {
    if (!this.entryRoot() && !this.focus() && !this.clusterScope()) return;
    this.pushHistory();
    this.entryRoot.set(null);
    this.focus.set(null);
    this.clusterScope.set(null);
    this.selectedCluster.set(null);
    this.fitToView();
  }

  // =========================================================== layout modes

  setLayoutMode(mode: LayoutMode): void {
    if (this.layoutMode() === mode) return;
    this.layoutMode.set(mode);
    safeStoreSet('vg-layout-mode', mode);
    if (mode === 'clusters') {
      this.clusterScope.set(null);
    } else {
      this.selectedCluster.set(null);
    }
    this.fitToView();
  }

  toggleLayoutMode(): void {
    this.setLayoutMode(this.layoutMode() === 'layers' ? 'clusters' : 'layers');
  }

  setClusterDisplay(display: ClusterDisplay): void {
    if (this.clusterDisplay() === display) return;
    this.clusterDisplay.set(display);
    safeStoreSet('vg-cluster-display', display);
  }

  toggleTreeFolder(key: string): void {
    const next = new Set(this.treeCollapsedKeys());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.treeCollapsedKeys.set(next);
  }

  private get treeDisplayActive(): boolean {
    return this.layoutMode() === 'clusters' && this.clusterDisplay() === 'tree';
  }

  setClusterMergeSteps(value: number): void {
    const max = this.clusterMergeMax();
    const v = Math.max(0, Math.min(max, Math.round(value)));
    this.clusterMergeSteps.set(v);
    safeStoreSet('vg-cluster-merges', String(v));
    this.fitToView();
  }

  selectCluster(id: string | null): void {
    this.selectedCluster.set(id);
  }

  /**
   * Switch to layered view scoped to the given community: every member becomes an
   * extra root, all are expanded, and clusterScope filters out outsiders.
   */
  openClusterInLayers(clusterId: string): void {
    const cl = this.clusterLayout();
    const community = cl?.communities.find((c) => c.id === clusterId) ?? cl?.clusters.find((c) => c.id === clusterId);
    const nodeIds = community && 'nodeIds' in community ? community.nodeIds : null;
    if (!nodeIds?.length) return;
    this.pushHistory();
    this.layoutMode.set('layers');
    safeStoreSet('vg-layout-mode', 'layers');
    this.selectedCluster.set(null);
    this.focus.set(null);
    this.entryRoot.set(null);
    this.clusterScope.set(new Set(nodeIds));
    this.extraRoots.set(new Set(nodeIds));
    this.expanded.set(new Set(nodeIds));
    this.selected.set(nodeIds[0]);
    this.kbNode.set(nodeIds[0]);
    this.fitToView();
  }

  clearClusterScope(): void {
    if (!this.clusterScope()) return;
    this.clusterScope.set(null);
    this.extraRoots.set(new Set());
    this.expanded.set(new Set());
    this.fitToView();
  }

  goBack(): void {
    const h = this.history();
    if (!h.length) return;
    const entry = h[h.length - 1];
    this.history.set(h.slice(0, -1));
    this.focus.set(entry.focus);
    this.selected.set(entry.selected);
    this.entryRoot.set(entry.entryRoot ?? null);
    this.fitToView();
  }

  resetAll(): void {
    this.expanded.set(new Set());
    this.extraRoots.set(new Set());
    this.focus.set(null);
    this.entryRoot.set(null);
    this.selected.set(null);
    this.kbNode.set(null);
    this.history.set([]);
    this.selectedCluster.set(null);
    this.clusterScope.set(null);
    this.setQuery('');
    this.fitToView();
  }

  expandAll(): void {
    if (this.treeDisplayActive) {
      this.treeCollapsedKeys.set(new Set());
      return;
    }
    const d = this.data();
    const idx = this.index();
    if (!d || !idx) return;
    const next = new Set(this.expanded());
    const entryRoot = this.entryRoot();
    if (entryRoot) {
      subtreeOf(idx, entryRoot).forEach((id) => {
        if (childCount(idx, id)) next.add(id);
      });
    } else {
      d.nodes.forEach((n) => {
        if (childCount(idx, n.id)) next.add(n.id);
      });
    }
    this.expanded.set(next);
    this.fitToView();
  }

  collapseAll(): void {
    if (this.treeDisplayActive) {
      const keys = new Set<string>();
      this.clusterTrees().forEach((t) => collectDirKeys(t).forEach((k) => keys.add(k)));
      this.treeCollapsedKeys.set(keys);
      return;
    }
    this.expanded.set(new Set());
    this.fitToView();
  }

  toggleExpand(id: string): void {
    const idx = this.index();
    if (!idx) return;
    if (this.expanded().has(id)) {
      const next = new Set(this.expanded());
      const q = [id];
      const seen = new Set<string>();
      let guard = 0;
      while (q.length && guard++ < 20000) {
        const v = q.shift()!;
        if (seen.has(v)) continue;
        seen.add(v);
        if (next.has(v)) {
          next.delete(v);
          outEdges(idx, v).forEach((e) => q.push(e.target));
        }
      }
      this.expanded.set(next);
    } else {
      const next = new Set(this.expanded());
      next.add(id);
      this.expanded.set(next);
    }
  }

  toggleShowOrphans(): void {
    this.showOrphans.update((v) => !v);
    this.fitToView();
  }

  setTab(t: NavTab): void {
    this.tab.set(t);
  }

  // =================================================================== tags

  toggleTagHidden(tag: string): void {
    const next = new Set(this.hiddenTags());
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    this.hiddenTags.set(next);
    safeStoreSet('vg-tags-hidden', JSON.stringify([...next]));
    this.fitToView();
  }

  showAllTags(): void {
    if (!this.hiddenTags().size) return;
    this.hiddenTags.set(new Set());
    safeStoreSet('vg-tags-hidden', '[]');
    this.fitToView();
  }

  /** Hides every tag except `tag` within its own namespace — "show only this layer". */
  isolateTag(tag: string): void {
    const ns = tag.includes(':') ? tag.slice(0, tag.indexOf(':')) : null;
    const next = new Set(this.hiddenTags());
    this.tagCountsByTag().forEach((_, t) => {
      const tns = t.includes(':') ? t.slice(0, t.indexOf(':')) : null;
      if (tns !== ns) return;
      if (t === tag) next.delete(t);
      else next.add(t);
    });
    this.hiddenTags.set(next);
    safeStoreSet('vg-tags-hidden', JSON.stringify([...next]));
    this.fitToView();
  }

  setTagColor(tag: string, color: string): void {
    const next = new Map(this.tagColors());
    next.set(tag, color);
    this.tagColors.set(next);
    this.persistTagColors(next);
  }

  clearTagColor(tag: string): void {
    if (!this.tagColors().has(tag)) return;
    const next = new Map(this.tagColors());
    next.delete(tag);
    this.tagColors.set(next);
    this.persistTagColors(next);
  }

  clearAllTagColors(): void {
    if (!this.tagColors().size) return;
    const next = new Map<string, string>();
    this.tagColors.set(next);
    this.persistTagColors(next);
  }

  private persistTagColors(colors: ReadonlyMap<string, string>): void {
    safeStoreSet('vg-tag-colors', JSON.stringify(Object.fromEntries(colors)));
  }

  // ------------------------------------------------- per-node hide / hand tags

  /** Hides (or shows again) one node and the branches only it reached. */
  toggleNodeHidden(id: string): void {
    const next = new Set(this.manualHidden());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.manualHidden.set(next);
    safeStoreSet('vg-nodes-hidden', JSON.stringify([...next]));
    /* A hidden node must not stay the selection/focus anchor — the panel would act on a ghost. */
    if (next.has(id)) {
      if (this.selected() === id) this.selected.set(null);
      if (this.kbNode() === id) this.kbNode.set(null);
      if (this.focus() === id) this.focus.set(null);
    }
    this.fitToView();
  }

  clearManualHidden(): void {
    if (!this.manualHidden().size) return;
    this.manualHidden.set(new Set());
    safeStoreSet('vg-nodes-hidden', '[]');
    this.fitToView();
  }

  /** Un-hides everything, whichever filter hid it. */
  showEverything(): void {
    this.showAllTags();
    this.clearManualHidden();
  }

  /**
   * Adds a hand-written tag to a node. Hand tags behave exactly like emitted ones (they group,
   * hide and colour identically), which is the point: they let you carve out a set the extractor
   * has no way to know about.
   */
  addNodeTag(id: string, rawTag: string): void {
    const tag = rawTag.trim().replace(/\s+/g, ' ');
    if (!tag) return;
    const d = this.data();
    if (!d || !d.byId.has(id)) return;
    if (this.tagsOf(id).includes(tag)) return;
    const next = new Map(this.manualTags());
    next.set(id, [...(next.get(id) ?? []), tag]);
    this.manualTags.set(next);
    this.persistManualTags(next);
  }

  /** Removes a hand-added tag. Extractor-emitted tags are read-only and are left untouched. */
  removeNodeTag(id: string, tag: string): void {
    const current = this.manualTags().get(id);
    if (!current?.includes(tag)) return;
    const next = new Map(this.manualTags());
    const remaining = current.filter((t) => t !== tag);
    if (remaining.length) next.set(id, remaining);
    else next.delete(id);
    this.manualTags.set(next);
    this.persistManualTags(next);
  }

  private persistManualTags(tags: ReadonlyMap<string, string[]>): void {
    safeStoreSet('vg-node-tags', JSON.stringify(Object.fromEntries(tags)));
  }

  /** Tag prefs are a user preference, not part of the extract — they outlive a reload. */
  private restoreTagPrefs(): void {
    const rawHidden = safeStoreGet('vg-tags-hidden');
    if (rawHidden) {
      try {
        const parsed: unknown = JSON.parse(rawHidden);
        if (Array.isArray(parsed)) {
          this.hiddenTags.set(new Set(parsed.filter((t): t is string => typeof t === 'string')));
        }
      } catch {
        /* ignore malformed prefs */
      }
    }
    const rawColors = safeStoreGet('vg-tag-colors');
    if (rawColors) {
      try {
        const parsed: unknown = JSON.parse(rawColors);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const next = new Map<string, string>();
          Object.entries(parsed as Record<string, unknown>).forEach(([k, v]) => {
            if (typeof v === 'string' && v) next.set(k, v);
          });
          this.tagColors.set(next);
        }
      } catch {
        /* ignore malformed prefs */
      }
    }
    const rawNodesHidden = safeStoreGet('vg-nodes-hidden');
    if (rawNodesHidden) {
      try {
        const parsed: unknown = JSON.parse(rawNodesHidden);
        if (Array.isArray(parsed)) {
          this.manualHidden.set(new Set(parsed.filter((id): id is string => typeof id === 'string')));
        }
      } catch {
        /* ignore malformed prefs */
      }
    }
    const rawNodeTags = safeStoreGet('vg-node-tags');
    if (rawNodeTags) {
      try {
        const parsed: unknown = JSON.parse(rawNodeTags);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const next = new Map<string, string[]>();
          Object.entries(parsed as Record<string, unknown>).forEach(([id, tags]) => {
            if (!Array.isArray(tags)) return;
            const clean = [...new Set(tags.filter((t): t is string => typeof t === 'string' && !!t.trim()))];
            if (clean.length) next.set(id, clean);
          });
          this.manualTags.set(next);
        }
      } catch {
        /* ignore malformed prefs */
      }
    }
  }

  setFocusDepth(d: number): void {
    this.focusDepth.set(d || 2);
  }

  // ================================================================= search

  setQuery(q: string): void {
    this.resultsClosed.set(false);
    this.query.set(q);
  }

  onSearchInput(q: string): void {
    this.srIndex.set(-1);
    this.setQuery(q);
  }

  clearQuery(): void {
    this.setQuery('');
    this.closeSearchResults();
  }

  closeSearchResults(): void {
    this.resultsClosed.set(true);
    this.srIndex.set(-1);
  }

  moveSearchCursor(dir: 'up' | 'down'): void {
    const list = this.searchResultIds();
    if (dir === 'down') this.srIndex.set(Math.min(list.length - 1, this.srIndex() + 1));
    else this.srIndex.set(Math.max(-1, this.srIndex() - 1));
  }

  pickSearchResult(id?: string): void {
    const list = this.searchResultIds();
    const pick = id ?? (this.srIndex() >= 0 ? list[this.srIndex()] : list[0]);
    if (!pick) return;
    this.select(pick, { reveal: true, center: true });
    this.closeSearchResults();
  }

  requestSearchFocus(): void {
    this.searchFocusToken.update((v) => v + 1);
  }

  // ================================================================ keyboard

  kbMove(dir: 'left' | 'right' | 'up' | 'down'): string | null {
    const L = this.layout();
    const v = this.visible();
    const idx = this.index();
    if (!L || !idx) return null;
    const cur = this.kbNode();
    if (!cur || !L.nodes.has(cur)) {
      let first: string | null = v && v.roots.length ? v.roots[0] : null;
      if (!first) {
        const it = L.nodes.keys().next();
        first = it.done ? null : it.value;
      }
      if (!first) return null;
      this.kbNode.set(first);
      this.selected.set(first);
      this.centerOn(first);
      return first;
    }
    const p = L.nodes.get(cur)!;
    let target: string | null = null;
    if (dir === 'left' || dir === 'right') {
      const row = Array.from(L.nodes.values())
        .filter((q) => q.layer === p.layer)
        .sort((a, b) => a.x - b.x);
      const i = row.findIndex((q) => q.id === cur);
      const j = dir === 'left' ? i - 1 : i + 1;
      if (j >= 0 && j < row.length) target = row[j].id;
    } else if (dir === 'down') {
      let kids = outEdges(idx, cur)
        .map((e) => e.target)
        .filter((t) => L.nodes.has(t));
      if (!kids.length && childCount(idx, cur)) {
        this.toggleExpand(cur);
        const L2 = this.layout()!;
        kids = outEdges(idx, cur)
          .map((e) => e.target)
          .filter((t) => L2.nodes.has(t));
      }
      const Lc = this.layout()!;
      kids.sort((a, b) => Math.abs(Lc.nodes.get(a)!.x - p.x) - Math.abs(Lc.nodes.get(b)!.x - p.x));
      target = kids[0] ?? null;
    } else {
      const ps = inEdges(idx, cur)
        .map((e) => e.source)
        .filter((t) => L.nodes.has(t));
      ps.sort((a, b) => Math.abs(L.nodes.get(a)!.x - p.x) - Math.abs(L.nodes.get(b)!.x - p.x));
      target = ps[0] ?? null;
    }
    if (!target) return null;
    this.kbNode.set(target);
    this.selected.set(target);
    this.centerOn(target);
    return target;
  }

  // ================================================================ viewport

  fitToView(): void {
    const L = this.layout();
    if (!L) return;
    this.view.set(computeFit(L.bbox, this.canvasRect()));
  }

  zoomBy(factor: number, center?: { x: number; y: number }): void {
    const rect = this.canvasRect();
    const c = center ?? { x: rect.width / 2, y: rect.height / 2 };
    this.view.set(computeZoom(this.view(), factor, c));
  }

  centerOn(id: string): void {
    const L = this.layout();
    if (!L) return;
    const p = L.nodes.get(id);
    if (!p) return;
    this.view.set(computeCenterOn({ x: p.x + NODE_W / 2, y: p.y + NODE_H / 2 }, this.canvasRect(), this.view().k));
  }

  // =================================================================== chrome

  applyTheme(t: ViewGraphTheme): void {
    this.theme.set(t);
    safeStoreSet('vg-theme', t);
  }

  cycleTheme(): void {
    const cur = this.theme();
    const next: ViewGraphTheme = cur === 'auto' ? 'light' : cur === 'light' ? 'dark' : 'auto';
    this.applyTheme(next);
  }

  onLegendToggle(open: boolean): void {
    this.legendOpen.set(open);
    safeStoreSet('vg-legend', open ? 'open' : 'closed');
  }

  toggleHelp(): void {
    this.helpOpen.update((v) => !v);
  }

  openHelp(): void {
    this.helpOpen.set(true);
  }

  closeHelp(): void {
    this.helpOpen.set(false);
  }
}
