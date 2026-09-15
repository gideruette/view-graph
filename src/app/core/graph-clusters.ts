/**
 * Entry-scoped clustering for the cluster view.
 *
 * 1. Seeds = entry points, except **provider** entries (controllers) that are already
 *    reachable from another entry via outgoing depends. After front+back merge,
 *    collapsed `consumer → controller` edges make those controllers descendants of
 *    the front routes that call them, so the front cluster owns the full stack.
 *    Peer front routes stay seeds even if a shell entry reaches them — otherwise
 *    everything collapses under AppComponent.
 * 2. Each seed claims nodes by closest directed distance (out-edges). Remaining
 *    one-sided contract nodes also accept an inbound step so a visible provider can
 *    be reached when the contract was not collapsed.
 * 3. The slider then merges clusters one-by-one (strongest remaining coupling first).
 */
import type { EntryTreeNode, GraphData, GraphEdge, GraphIndex, GraphNode } from './graph-model';
import { inEdges, outEdges } from './graph-model';

/** Minimal visible-subgraph shape (avoids importing graph-layout). */
export interface ClusterableGraph {
  nodes: Set<string>;
  edges: GraphEdge[];
  /** Fallback seeds when no entry point lies in the visible set. */
  roots?: string[];
}

export interface CommunityPartition {
  /** community id → member node ids (sorted) */
  communities: Map<string, string[]>;
  /** node id → community id */
  assignment: Map<string, string>;
}

export interface LabeledCommunity {
  id: string;
  nodeIds: string[];
  label: string;
  subtitle: string;
  colorIndex: number;
}

/** Default slider: no extra merges beyond contract bridging. */
export const DEFAULT_CLUSTER_MERGE_STEPS = 0;

/** @deprecated use DEFAULT_CLUSTER_MERGE_STEPS */
export const DEFAULT_CLUSTER_RESOLUTION = DEFAULT_CLUSTER_MERGE_STEPS;

type MergeCandidate = { a: string; b: string; w: number; coupling: number };

/**
 * Build clusters from entry-point trees (with contract bridges), then apply the
 * first `mergeSteps` strongest remaining cross-cluster merges.
 */
export function detectCommunities(
  view: ClusterableGraph,
  index: GraphIndex,
  data: GraphData,
  mergeSteps = DEFAULT_CLUSTER_MERGE_STEPS,
): CommunityPartition {
  const plan = planEntryClusters(view, index, data);
  if (!plan) {
    const ids = [...view.nodes].sort();
    if (!ids.length) return { communities: new Map(), assignment: new Map() };
    const communities = new Map<string, string[]>([['misc', ids]]);
    const assignment = new Map<string, string>();
    ids.forEach((id) => assignment.set(id, 'misc'));
    return finalizeIds(communities, assignment);
  }

  const { communities, assignment } = applyMergeSteps(
    plan.communities,
    plan.assignment,
    plan.ranked,
    mergeSteps,
  );
  return finalizeIds(communities, assignment);
}

/** How many slider notches are available for the current visible graph. */
export function maxClusterMerges(view: ClusterableGraph, index: GraphIndex, data: GraphData): number {
  /* The merge slider exists to compensate for the flat heuristic's imprecision; it has no meaning
   * once grouping instead follows the extractor's real route/sub-route tree. */
  if (data.entries.length) return 0;
  return planEntryClusters(view, index, data)?.maxMerges ?? 0;
}

function planEntryClusters(
  view: ClusterableGraph,
  index: GraphIndex,
  data: GraphData,
): {
  communities: Map<string, string[]>;
  assignment: Map<string, string>;
  ranked: MergeCandidate[];
  maxMerges: number;
} | null {
  const visible = view.nodes;
  if (!visible.size) return null;

  const seeds = resolveSeeds(view, index, data);
  if (!seeds.length) return null;

  let { assignment } = assignByClosestEntry(seeds, visible, index, data);
  const unclaimed = [...visible].filter((id) => !assignment.has(id));
  if (unclaimed.length) {
    unclaimed.sort();
    unclaimed.forEach((id) => assignment.set(id, 'misc'));
  }

  const communities = groupByAssignment(assignment);
  const ranked = rankMergeCandidates(communities, assignment, view.edges);
  const maxMerges = countSuccessfulMerges(communities, ranked);
  return { communities, assignment, ranked, maxMerges };
}

/**
 * Entry points (or layout roots). Provider entries (controllers) that another entry
 * already reaches via outgoing depends are dropped as seeds so the caller owns the
 * full stack — but front routes reachable from a shell entry stay seeds.
 */
function resolveSeeds(view: ClusterableGraph, index: GraphIndex, data: GraphData): string[] {
  const fromEntries = data.entryPoints.filter((id) => view.nodes.has(id));
  const candidates = fromEntries.length
    ? fromEntries.slice().sort()
    : [...new Set((view.roots ?? []).filter((id) => view.nodes.has(id)))].sort();
  if (candidates.length <= 1) return candidates;

  const demotable = new Set(candidates.filter((id) => isProviderEntry(data, id)));
  if (!demotable.size) return candidates;

  const reachableProvider = new Set<string>();
  candidates.forEach((seed) => {
    const seen = new Set<string>([seed]);
    const q = [seed];
    let qi = 0;
    while (qi < q.length) {
      const v = q[qi++];
      outEdges(index, v).forEach((e) => {
        const t = e.target;
        if (!view.nodes.has(t) || seen.has(t)) return;
        seen.add(t);
        if (demotable.has(t) && t !== seed) reachableProvider.add(t);
        q.push(t);
      });
    }
  });
  return candidates.filter((id) => !reachableProvider.has(id));
}

/** Backend HTTP providers listed as entry points — safe to absorb into a caller cluster. */
function isProviderEntry(data: GraphData, id: string): boolean {
  const n = data.byId.get(id);
  if (!n) return false;
  if (n.kind === 'controller') return true;
  return n.tags.includes('type:controller');
}

function isContractNode(data: GraphData, id: string): boolean {
  const n = data.byId.get(id);
  if (!n) return id.startsWith('api:');
  if (n.kind === 'contract') return true;
  if (n.tags.includes('type:contract')) return true;
  return id.startsWith('api:');
}

/**
 * Per-entry BFS along outgoing deps. At still-visible contract nodes only, also
 * walk inbound (provider/controller → contract) so a one-sided extract can still
 * reach the other stack — without inbound-on-controller, which would pull every
 * sibling consumer of a shared API into the same reachability set.
 */
function assignByClosestEntry(
  seeds: string[],
  visible: Set<string>,
  index: GraphIndex,
  data: GraphData,
): { assignment: Map<string, string>; depths: Map<string, number> } {
  const assignment = new Map<string, string>();
  const depths = new Map<string, number>();

  seeds.forEach((seed) => {
    const depth = new Map<string, number>();
    depth.set(seed, 0);
    const q = [seed];
    let qi = 0;
    while (qi < q.length) {
      const v = q[qi++];
      const d = depth.get(v)!;
      const visit = (t: string): void => {
        if (!visible.has(t) || depth.has(t)) return;
        depth.set(t, d + 1);
        q.push(t);
      };
      outEdges(index, v).forEach((e) => visit(e.target));
      if (isContractNode(data, v)) {
        inEdges(index, v).forEach((e) => visit(e.source));
      }
    }
    depth.forEach((d, node) => {
      const prev = depths.get(node);
      const prevOwner = assignment.get(node);
      if (
        prev == null ||
        d < prev ||
        (d === prev && prevOwner != null && seed.localeCompare(prevOwner) < 0)
      ) {
        depths.set(node, d);
        assignment.set(node, seed);
      }
    });
  });

  return { assignment, depths };
}

/**
 * Route/sub-route grouping built directly from the extractor's `entries` tree (SCHEMA.md § entries),
 * instead of the flat entry-point community partition above. Each tree level competes for nodes via
 * the same closest-entry BFS (`assignByClosestEntry`), scoped to the pool its parent already claimed —
 * so a node ends up under the deepest route that actually reaches it, mirroring the real route nesting
 * (parent shell -> nested route -> its own sub-routes) instead of one flat layer of siblings.
 */
export interface ClusterNode {
  id: string;
  label: string;
  colorIndex: number;
  /** Nodes claimed at this level specifically (not further claimed by any child entry). */
  ownNodeIds: string[];
  /** All nodes under this branch: ownNodeIds plus every descendant's nodeIds. */
  nodeIds: string[];
  children: ClusterNode[];
}

/** Builds the nested cluster tree, or null when the extract carries no `entries` (fall back to flat mode). */
export function buildEntryClusterTree(view: ClusterableGraph, index: GraphIndex, data: GraphData): ClusterNode[] | null {
  if (!data.entries.length) return null;
  const visible = view.nodes;
  if (!visible.size) return null;

  let idSeq = 0;
  const nextId = () => `e${idSeq++}`;

  const build = (siblings: EntryTreeNode[], available: Set<string>): ClusterNode[] => {
    if (!siblings.length || !available.size) return [];

    const seeded = siblings.filter((s) => s.nodeId && available.has(s.nodeId));
    const seedIds = seeded.map((s) => s.nodeId!);
    const { assignment } = seedIds.length
      ? assignByClosestEntry(seedIds, available, index, data)
      : { assignment: new Map<string, string>() };

    const poolBySeed = new Map<string, Set<string>>();
    seedIds.forEach((id) => poolBySeed.set(id, new Set()));
    assignment.forEach((seedId, nodeId) => poolBySeed.get(seedId)?.add(nodeId));

    const remaining = new Set(available);
    poolBySeed.forEach((pool) => pool.forEach((id) => remaining.delete(id)));

    const result: ClusterNode[] = [];

    seeded.forEach((s) => {
      const pool = poolBySeed.get(s.nodeId!)!;
      const children = build(s.children, pool);
      const claimed = new Set<string>();
      children.forEach((c) => c.nodeIds.forEach((id) => claimed.add(id)));
      result.push({
        id: nextId(),
        label: s.label,
        colorIndex: 0,
        ownNodeIds: [...pool].filter((id) => !claimed.has(id)).sort(),
        nodeIds: [...pool].sort(),
        children,
      });
    });

    /* Pure grouping labels (no nodeId of their own — e.g. a route with only a path, no component)
     * can't seed a BFS round, so their descendants compete only for whatever their seeded siblings
     * left behind, claimed in declaration order. */
    siblings
      .filter((s) => !seeded.includes(s))
      .forEach((s) => {
        if (!remaining.size) return;
        const children = build(s.children, new Set(remaining));
        const claimed = new Set<string>();
        children.forEach((c) => c.nodeIds.forEach((id) => claimed.add(id)));
        if (!claimed.size) return;
        claimed.forEach((id) => remaining.delete(id));
        result.push({
          id: nextId(),
          label: s.label,
          colorIndex: 0,
          ownNodeIds: [],
          nodeIds: [...claimed].sort(),
          children,
        });
      });

    return result;
  };

  const top = build(data.entries, new Set(visible));
  const claimedTop = new Set<string>();
  top.forEach((c) => c.nodeIds.forEach((id) => claimedTop.add(id)));
  const leftover = [...visible].filter((id) => !claimedTop.has(id)).sort();
  if (leftover.length) {
    top.push({ id: 'misc', label: 'Other', colorIndex: 0, ownNodeIds: leftover, nodeIds: leftover, children: [] });
  }
  if (!top.length) return null;

  let colorSeq = 0;
  const assignColor = (n: ClusterNode): void => {
    n.colorIndex = colorSeq++;
    n.children.forEach(assignColor);
  };
  top.forEach(assignColor);

  return top;
}

/** Flattens the nested tree into the same `{communities, assignment}` shape the flat partition produces,
 *  so folder-tree rendering and node->cluster lookups work unmodified. `assignment` maps each node to the
 *  deepest cluster that actually claims it (its `ownNodeIds` owner), never an ancestor. */
export function flattenClusterTree(top: ClusterNode[]): {
  assignment: Map<string, string>;
  labeled: LabeledCommunity[];
} {
  const assignment = new Map<string, string>();
  const labeled: LabeledCommunity[] = [];
  const visit = (n: ClusterNode): void => {
    labeled.push({
      id: n.id,
      nodeIds: n.nodeIds,
      label: n.label,
      subtitle: `${n.nodeIds.length} node${n.nodeIds.length === 1 ? '' : 's'}`,
      colorIndex: n.colorIndex,
    });
    n.ownNodeIds.forEach((id) => assignment.set(id, n.id));
    n.children.forEach(visit);
  };
  top.forEach(visit);
  return { assignment, labeled };
}

function groupByAssignment(assignment: Map<string, string>): Map<string, string[]> {
  const communities = new Map<string, string[]>();
  assignment.forEach((cid, nodeId) => {
    if (!communities.has(cid)) communities.set(cid, []);
    communities.get(cid)!.push(nodeId);
  });
  communities.forEach((members, cid) => communities.set(cid, members.sort()));
  return communities;
}

function rankMergeCandidates(
  communities: Map<string, string[]>,
  assignment: Map<string, string>,
  edges: GraphEdge[],
): MergeCandidate[] {
  const cross = new Map<string, number>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}\0${b}` : `${b}\0${a}`);

  edges.forEach((e) => {
    const ca = assignment.get(e.source);
    const cb = assignment.get(e.target);
    if (!ca || !cb || ca === cb) return;
    const k = pairKey(ca, cb);
    cross.set(k, (cross.get(k) ?? 0) + 1);
  });

  return [...cross.entries()]
    .map(([key, w]) => {
      const [a, b] = key.split('\0');
      const na = communities.get(a)?.length ?? 1;
      const nb = communities.get(b)?.length ?? 1;
      return { a, b, w, coupling: w / Math.min(na, nb) };
    })
    .sort((x, y) => y.coupling - x.coupling || y.w - x.w || x.a.localeCompare(y.a));
}

/**
 * Apply the first `mergeSteps` successful unions from a fixed ranked candidate list.
 * Candidates that would unite already-merged clusters are skipped (do not consume a step).
 */
function applyMergeSteps(
  communities: Map<string, string[]>,
  assignment: Map<string, string>,
  ranked: MergeCandidate[],
  mergeSteps: number,
): { communities: Map<string, string[]>; assignment: Map<string, string> } {
  const steps = Math.max(0, Math.floor(mergeSteps));
  if (communities.size <= 1 || steps <= 0 || !ranked.length) {
    return { communities, assignment };
  }

  const parent = new Map<string, string>();
  communities.forEach((_, id) => parent.set(id, id));

  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (c !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };

  let applied = 0;
  for (const { a, b } of ranked) {
    if (applied >= steps) break;
    if (!communities.has(a) || !communities.has(b)) continue;
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) continue;
    const keep = pickRep(ra, rb);
    const drop = keep === ra ? rb : ra;
    parent.set(drop, keep);
    applied++;
  }

  const merged = new Map<string, string[]>();
  const nextAssignment = new Map<string, string>();
  communities.forEach((members, id) => {
    const root = find(id);
    if (!merged.has(root)) merged.set(root, []);
    merged.get(root)!.push(...members);
  });
  merged.forEach((members, id) => {
    const uniq = [...new Set(members)].sort();
    merged.set(id, uniq);
    uniq.forEach((n) => nextAssignment.set(n, id));
  });
  return { communities: merged, assignment: nextAssignment };
}

function countSuccessfulMerges(communities: Map<string, string[]>, ranked: MergeCandidate[]): number {
  if (communities.size <= 1 || !ranked.length) return 0;
  const parent = new Map<string, string>();
  communities.forEach((_, id) => parent.set(id, id));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  let n = 0;
  for (const { a, b } of ranked) {
    if (!communities.has(a) || !communities.has(b)) continue;
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) continue;
    parent.set(rb, ra);
    n++;
  }
  return n;
}

function pickRep(a: string, b: string): string {
  if (a === 'misc') return b;
  if (b === 'misc') return a;
  return a.localeCompare(b) < 0 ? a : b;
}

function finalizeIds(communities: Map<string, string[]>, assignment: Map<string, string>): CommunityPartition {
  const entries = [...communities.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );
  const outCommunities = new Map<string, string[]>();
  const outAssignment = new Map<string, string>();
  entries.forEach(([oldId, members], i) => {
    const id = oldId === 'misc' ? 'misc' : `c${i}`;
    const sorted = members.slice().sort();
    outCommunities.set(id, sorted);
    sorted.forEach((n) => outAssignment.set(n, id));
  });
  void assignment;
  return { communities: outCommunities, assignment: outAssignment };
}

export function labelCommunities(
  part: CommunityPartition,
  data: GraphData,
  nodeTags: ReadonlyMap<string, string[]>,
): LabeledCommunity[] {
  const entries = [...part.communities.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  return entries.map(([id, nodeIds], colorIndex) => {
    const label = id === 'misc' ? 'Other' : pickLabel(nodeIds, data, nodeTags);
    const subtitle = `${nodeIds.length} node${nodeIds.length === 1 ? '' : 's'}`;
    return { id, nodeIds, label, subtitle, colorIndex };
  });
}

function pickLabel(nodeIds: string[], data: GraphData, nodeTags: ReadonlyMap<string, string[]>): string {
  const memberSet = new Set(nodeIds);

  const seedEntries = data.entryPoints.filter((ep) => memberSet.has(ep));
  if (seedEntries.length === 1) {
    return data.byId.get(seedEntries[0])?.name ?? seedEntries[0];
  }
  if (seedEntries.length > 1) {
    const names = seedEntries
      .map((ep) => data.byId.get(ep)?.name ?? ep)
      .sort((a, b) => a.localeCompare(b));
    if (names.length <= 3) return names.join(' + ');
    return `${names.slice(0, 2).join(' + ')} +${names.length - 2}`;
  }

  const nodes = nodeIds.map((id) => data.byId.get(id)).filter((n): n is GraphNode => !!n);
  const pathLabel = commonPathPrefix(nodes);
  if (pathLabel) return pathLabel;

  const typeCounts = new Map<string, number>();
  nodeIds.forEach((id) => {
    (nodeTags.get(id) ?? []).forEach((t) => {
      if (!t.startsWith('type:')) return;
      typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    });
  });
  if (typeCounts.size) {
    const [tag, count] = [...typeCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (count >= Math.ceil(nodeIds.length * 0.4)) return tag.slice('type:'.length);
  }

  if (nodes.length === 1) return nodes[0].name;
  return `Cluster ${nodeIds.length}`;
}

function commonPathPrefix(nodes: GraphNode[]): string | null {
  const partsList = nodes
    .map((n) => n.file)
    .filter((f): f is string => !!f)
    .map((f) => f.replace(/\\/g, '/').split('/').filter(Boolean));
  if (partsList.length < Math.max(2, Math.ceil(nodes.length * 0.5))) return null;
  if (!partsList.length) return null;

  const minLen = Math.min(...partsList.map((p) => p.length));
  const common: string[] = [];
  for (let i = 0; i < minLen; i++) {
    const seg = partsList[0][i];
    if (partsList.every((p) => p[i] === seg)) common.push(seg);
    else break;
  }
  while (common.length && /\.[a-zA-Z0-9]+$/.test(common[common.length - 1])) common.pop();
  if (common.length < 1) return null;
  return common.slice(-2).join('/');
}

/** Inter-cluster edge weights from the visible directed edges. */
export function aggregateClusterEdges(
  view: ClusterableGraph,
  assignment: Map<string, string>,
): { source: string; target: string; weight: number; edges: GraphEdge[] }[] {
  const bag = new Map<string, { source: string; target: string; weight: number; edges: GraphEdge[] }>();
  view.edges.forEach((e) => {
    const cs = assignment.get(e.source);
    const ct = assignment.get(e.target);
    if (!cs || !ct || cs === ct) return;
    const key = `${cs}->${ct}`;
    let row = bag.get(key);
    if (!row) {
      row = { source: cs, target: ct, weight: 0, edges: [] };
      bag.set(key, row);
    }
    row.weight++;
    row.edges.push(e);
  });
  return [...bag.values()].sort((a, b) => b.weight - a.weight || a.source.localeCompare(b.source));
}
