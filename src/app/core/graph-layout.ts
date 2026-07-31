/**
 * Visible-subgraph selection + layered layout algorithm.
 * Pure port of currentRoots()/computeVisible()/layout() from the former
 * engine/viewer-engine.js (no DOM, no Angular — deterministic given inputs).
 */
import { type GraphData, type GraphEdge, type GraphIndex, inEntryScope, orphanIds, outEdges } from './graph-model';
import { edgeKey, uniq } from './utils';

export const NODE_W = 224;
export const NODE_H = 56;
export const H_GAP = 28;
export const V_GAP = 88;

export interface VisibilityState {
  focus: string | null;
  focusDepth: number;
  entryRoot: string | null;
  expanded: ReadonlySet<string>;
  extraRoots: ReadonlySet<string>;
  showOrphans: boolean;
  /** Nodes pruned by the tag filter (see `hiddenByTags`) — never traversed, never rendered. */
  hidden: ReadonlySet<string>;
}

export interface VisibleGraph {
  roots: string[];
  nodes: Set<string>;
  edges: GraphEdge[];
}

function ancestorsOfFocus(index: GraphIndex, entryRoot: string | null, focus: string): Set<string> {
  const seen = new Set<string>([focus]);
  const q = [focus];
  let guard = 0;
  while (q.length && guard++ < 100000) {
    const v = q.shift()!;
    if (entryRoot && v === entryRoot) continue;
    (index.inn.get(v) ?? []).forEach((e) => {
      if (seen.has(e.source)) return;
      seen.add(e.source);
      q.push(e.source);
    });
  }
  seen.delete(focus);
  return seen;
}

function descendantsOfFocus(index: GraphIndex, focus: string): Map<string, number> {
  const depth = new Map<string, number>();
  const q = [focus];
  const seen = new Set<string>([focus]);
  let guard = 0;
  while (q.length && guard++ < 100000) {
    const v = q.shift()!;
    const d0 = v === focus ? 0 : (depth.get(v) ?? 0);
    outEdges(index, v).forEach((e) => {
      if (seen.has(e.target)) return;
      seen.add(e.target);
      depth.set(e.target, d0 + 1);
      q.push(e.target);
    });
  }
  return depth;
}

function currentRoots(data: GraphData, index: GraphIndex, state: VisibilityState): string[] {
  let roots: string[] = [];
  if (state.focus) {
    const anc = ancestorsOfFocus(index, state.entryRoot, state.focus);
    let rs: string[] = [];
    anc.forEach((a) => {
      if (state.entryRoot && !inEntryScope(index, state.entryRoot, a) && a !== state.entryRoot) return;
      const hasParentInSet = (index.inn.get(a) ?? []).some(
        (e) => anc.has(e.source) && (!state.entryRoot || inEntryScope(index, state.entryRoot, e.source) || e.source === state.entryRoot),
      );
      if (!hasParentInSet) rs.push(a);
    });
    if (state.entryRoot && rs.indexOf(state.entryRoot) < 0 && (anc.has(state.entryRoot) || state.focus === state.entryRoot)) {
      rs = [state.entryRoot];
    }
    roots = rs.length ? rs : [state.focus];
  } else if (state.entryRoot) {
    roots = [state.entryRoot];
    state.extraRoots.forEach((id) => {
      if (id !== state.entryRoot && inEntryScope(index, state.entryRoot, id)) roots.push(id);
    });
  } else {
    roots = data.entryPoints.slice();
    state.extraRoots.forEach((id) => {
      if (roots.indexOf(id) < 0) roots.push(id);
    });
    if (state.showOrphans) {
      orphanIds(data, index).forEach((id) => {
        if (roots.indexOf(id) < 0) roots.push(id);
      });
    }
  }
  return uniq(roots).filter((id) => !state.hidden.has(id));
}

export function computeVisibleGraph(data: GraphData, index: GraphIndex, state: VisibilityState): VisibleGraph {
  const roots = currentRoots(data, index, state);
  const nodes = new Set<string>();
  const edges: GraphEdge[] = [];
  const edgeSeen = new Set<string>();

  if (state.focus && state.hidden.has(state.focus)) {
    /* the focused node itself is tag-filtered away — nothing to render */
    return { roots, nodes, edges };
  }

  if (state.focus) {
    const anc = ancestorsOfFocus(index, state.entryRoot, state.focus);
    const desc = descendantsOfFocus(index, state.focus);
    nodes.add(state.focus);
    anc.forEach((id) => nodes.add(id));
    desc.forEach((d, id) => {
      if (d <= state.focusDepth) nodes.add(id);
    });
    /* expand beyond focusDepth when the user opens nodes */
    const expandQ: string[] = [];
    nodes.forEach((id) => {
      if (state.expanded.has(id)) expandQ.push(id);
    });
    const expandSeen = new Set(nodes);
    while (expandQ.length) {
      const ev = expandQ.shift()!;
      if (state.hidden.has(ev)) continue;
      outEdges(index, ev).forEach((e) => {
        if (expandSeen.has(e.target) || state.hidden.has(e.target)) return;
        expandSeen.add(e.target);
        nodes.add(e.target);
        if (state.expanded.has(e.target)) expandQ.push(e.target);
      });
    }
    if (state.entryRoot) {
      Array.from(nodes).forEach((id) => {
        if (!inEntryScope(index, state.entryRoot, id) && id !== state.entryRoot) nodes.delete(id);
      });
    }
  } else {
    roots.forEach((r) => nodes.add(r));
    /* Restrict view: show the full ancestor chain unconditionally (like focus mode does) —
     * the manual expand/collapse tree below only ever walks outgoing edges, so without this a
     * restricted leaf node (no descendants) would render as an empty graph. */
    if (state.entryRoot) {
      ancestorsOfFocus(index, null, state.entryRoot).forEach((id) => nodes.add(id));
    }
    const q = roots.slice();
    const seen = new Set(roots);
    while (q.length) {
      const v = q.shift()!;
      if (!state.expanded.has(v)) continue;
      outEdges(index, v).forEach((e) => {
        if (state.entryRoot && !inEntryScope(index, state.entryRoot, e.target)) return;
        if (state.hidden.has(e.target)) return;
        nodes.add(e.target);
        if (!seen.has(e.target)) {
          seen.add(e.target);
          q.push(e.target);
        }
      });
    }
  }

  /* backstop: ancestor chains above are walked unfiltered, so purge before wiring edges */
  state.hidden.forEach((id) => nodes.delete(id));

  nodes.forEach((id) => {
    outEdges(index, id).forEach((e) => {
      if (!nodes.has(e.target)) return;
      const k = edgeKey(e);
      if (edgeSeen.has(k)) return;
      edgeSeen.add(k);
      edges.push(e);
    });
  });

  return { roots, nodes, edges };
}

export interface NodePosition {
  id: string;
  x: number;
  y: number;
  layer: number;
}

export interface EdgeGeometry {
  e: GraphEdge;
  key: string;
  d: string;
  mid: { x: number; y: number };
  isBack: boolean;
}

export interface LayoutResult {
  nodes: Map<string, NodePosition>;
  edges: EdgeGeometry[];
  layers: string[][];
  bbox: { x: number; y: number; w: number; h: number };
}

/** Layered (Sugiyama-style) layout: rank assignment, barycenter ordering, packing, edge geometry. */
export function layoutGraph(view: VisibleGraph, index: GraphIndex): LayoutResult {
  const vis = view.nodes;
  const eds = view.edges;
  const ids = Array.from(vis);
  const fwd = eds.filter((e) => !index.backEdges.has(edgeKey(e)) && e.source !== e.target);

  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  ids.forEach((id) => {
    indeg.set(id, 0);
    adj.set(id, []);
  });
  fwd.forEach((e) => {
    indeg.set(e.target, indeg.get(e.target)! + 1);
    adj.get(e.source)!.push(e.target);
  });
  const layer = new Map<string, number>();
  const queue: string[] = [];
  ids.forEach((id) => {
    if (indeg.get(id) === 0) {
      layer.set(id, 0);
      queue.push(id);
    }
  });
  let processed = 0;
  while (queue.length) {
    const v = queue.shift()!;
    processed++;
    adj.get(v)!.forEach((t) => {
      const cand = layer.get(v)! + 1;
      if (!layer.has(t) || layer.get(t)! < cand) layer.set(t, cand);
      indeg.set(t, indeg.get(t)! - 1);
      if (indeg.get(t) === 0) queue.push(t);
    });
  }
  if (processed < ids.length) {
    ids.forEach((id) => {
      if (layer.has(id)) return;
      let mx = 0;
      eds.forEach((e) => {
        if (e.target === id && layer.has(e.source)) mx = Math.max(mx, layer.get(e.source)! + 1);
      });
      layer.set(id, mx);
    });
  }
  ids.forEach((id) => {
    if (!layer.has(id)) layer.set(id, 0);
  });

  const layers: string[][] = [];
  ids.forEach((id) => {
    const l = layer.get(id)!;
    while (layers.length <= l) layers.push([]);
    layers[l].push(id);
  });

  const seedRank = new Map<string, number>();
  let rk = 0;
  const seen = new Set<string>();
  const stack = view.roots.slice().reverse();
  while (stack.length) {
    const v2 = stack.pop()!;
    if (seen.has(v2)) continue;
    seen.add(v2);
    seedRank.set(v2, rk++);
    const kids = outEdges(index, v2)
      .map((e) => e.target)
      .filter((t) => vis.has(t) && !seen.has(t));
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  ids.forEach((id) => {
    if (!seedRank.has(id)) seedRank.set(id, rk++);
  });
  layers.forEach((L) => L.sort((a, b) => seedRank.get(a)! - seedRank.get(b)!));

  const pos = new Map<string, number>();
  function reindex(): void {
    layers.forEach((L) => L.forEach((id, i) => pos.set(id, i)));
  }
  reindex();
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  ids.forEach((id) => {
    parents.set(id, []);
    children.set(id, []);
  });
  fwd.forEach((e) => {
    children.get(e.source)!.push(e.target);
    parents.get(e.target)!.push(e.source);
  });
  function bary(id: string, rel: 'up' | 'down'): number | null {
    const a = rel === 'up' ? parents.get(id)! : children.get(id)!;
    if (!a.length) return null;
    let s = 0;
    let c = 0;
    a.forEach((x) => {
      if (pos.has(x)) {
        s += pos.get(x)!;
        c++;
      }
    });
    return c ? s / c : null;
  }
  for (let sweep = 0; sweep < 6; sweep++) {
    const down = sweep % 2 === 0;
    for (let li = 0; li < layers.length; li++) {
      const L = layers[down ? li : layers.length - 1 - li];
      if (L.length < 2) continue;
      const keys = new Map<string, number>();
      L.forEach((id, i) => {
        const b = bary(id, down ? 'up' : 'down');
        keys.set(id, b == null ? i : b);
      });
      L.sort((a, b) => {
        const d2 = keys.get(a)! - keys.get(b)!;
        return d2 !== 0 ? d2 : seedRank.get(a)! - seedRank.get(b)!;
      });
      reindex();
    }
  }

  const X = new Map<string, number>();
  layers.forEach((L) => {
    L.forEach((id, i) => X.set(id, i * (NODE_W + H_GAP)));
  });
  function pack(L: string[]): void {
    for (let i = 1; i < L.length; i++) {
      const minX = X.get(L[i - 1])! + NODE_W + H_GAP;
      if (X.get(L[i])! < minX) X.set(L[i], minX);
    }
    for (let j = L.length - 2; j >= 0; j--) {
      const maxX = X.get(L[j + 1])! - NODE_W - H_GAP;
      if (X.get(L[j])! > maxX) X.set(L[j], maxX);
    }
  }
  for (let it = 0; it < 8; it++) {
    const goDown = it % 2 === 0;
    for (let k = 0; k < layers.length; k++) {
      const L2 = layers[goDown ? k : layers.length - 1 - k];
      L2.forEach((id) => {
        const a = goDown ? parents.get(id)! : children.get(id)!;
        if (!a.length) return;
        let s = 0;
        let c = 0;
        a.forEach((x) => {
          if (X.has(x)) {
            s += X.get(x)!;
            c++;
          }
        });
        if (c) X.set(id, s / c);
      });
      L2.sort((a, b) => X.get(a)! - X.get(b)! || pos.get(a)! - pos.get(b)!);
      pack(L2);
    }
    reindex();
  }
  layers.forEach(pack);

  let minX = Infinity;
  let maxX2 = -Infinity;
  ids.forEach((id) => {
    minX = Math.min(minX, X.get(id)!);
    maxX2 = Math.max(maxX2, X.get(id)! + NODE_W);
  });
  if (!isFinite(minX)) {
    minX = 0;
    maxX2 = NODE_W;
  }
  const total = maxX2 - minX;
  const nodesOut = new Map<string, NodePosition>();
  layers.forEach((L, li) => {
    let lmin = Infinity;
    let lmax = -Infinity;
    L.forEach((id) => {
      lmin = Math.min(lmin, X.get(id)!);
      lmax = Math.max(lmax, X.get(id)! + NODE_W);
    });
    const shift = (total - (lmax - lmin)) / 2 - (lmin - minX);
    L.forEach((id) => {
      nodesOut.set(id, { id, x: X.get(id)! - minX + shift, y: li * (NODE_H + V_GAP), layer: li });
    });
  });

  const inPort = new Map<string, number>();
  const outPort = new Map<string, number>();
  function portIndex(map: Map<string, number>, id: string): number {
    if (!map.has(id)) map.set(id, 0);
    const i = map.get(id)!;
    map.set(id, i + 1);
    return i;
  }
  const inCount = new Map<string, number>();
  const outCount = new Map<string, number>();
  eds.forEach((e) => {
    inCount.set(e.target, (inCount.get(e.target) ?? 0) + 1);
    outCount.set(e.source, (outCount.get(e.source) ?? 0) + 1);
  });
  const sorted = eds.slice().sort((a, b) => {
    const na = nodesOut.get(a.target);
    const nb = nodesOut.get(b.target);
    return (na ? na.x : 0) - (nb ? nb.x : 0);
  });
  const geo: EdgeGeometry[] = [];
  sorted.forEach((e) => {
    const s = nodesOut.get(e.source);
    const t = nodesOut.get(e.target);
    if (!s || !t) return;
    const isBack = index.backEdges.has(edgeKey(e)) || e.source === e.target || t.layer <= s.layer;
    const oi = portIndex(outPort, e.source);
    const on = outCount.get(e.source) ?? 1;
    const ii = portIndex(inPort, e.target);
    const inn2 = inCount.get(e.target) ?? 1;
    const spread = Math.min(NODE_W * 0.6, 20 * Math.max(on, inn2));
    const sx = s.x + NODE_W / 2 + (on > 1 ? (oi - (on - 1) / 2) * (spread / Math.max(1, on - 1)) : 0);
    const tx = t.x + NODE_W / 2 + (inn2 > 1 ? (ii - (inn2 - 1) / 2) * (spread / Math.max(1, inn2 - 1)) : 0);
    let d: string;
    let mid: { x: number; y: number };
    if (e.source === e.target) {
      const cx = s.x + NODE_W;
      const cy = s.y + NODE_H / 2;
      d = `M${cx},${cy - 12} C${cx + 56},${cy - 34} ${cx + 56},${cy + 34} ${cx},${cy + 12}`;
      mid = { x: cx + 40, y: cy };
    } else if (isBack) {
      const goRight = t.x >= s.x;
      const sxx = goRight ? s.x + NODE_W : s.x;
      const txx = goRight ? t.x + NODE_W : t.x;
      const off = (goRight ? 1 : -1) * (46 + 16 * Math.abs(s.layer - t.layer));
      const sy = s.y + NODE_H / 2;
      const ty = t.y + NODE_H / 2;
      d = `M${sxx},${sy} C${sxx + off},${sy} ${txx + off},${ty} ${txx},${ty}`;
      mid = { x: (sxx + txx) / 2 + off * 0.72, y: (sy + ty) / 2 };
    } else {
      const y1 = s.y + NODE_H;
      const y2 = t.y;
      const c = Math.max(22, Math.min((y2 - y1) * 0.5, 70));
      d = `M${sx},${y1} C${sx},${y1 + c} ${tx},${y2 - c} ${tx},${y2}`;
      mid = { x: (sx + tx) / 2, y: (y1 + y2) / 2 };
    }
    geo.push({ e, key: edgeKey(e), d, mid, isBack });
  });

  const bbox = {
    x: 0,
    y: 0,
    w: total,
    h: Math.max(NODE_H, layers.length * (NODE_H + V_GAP) - V_GAP),
  };
  return { nodes: nodesOut, edges: geo, layers, bbox };
}
