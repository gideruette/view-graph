/**
 * Two-level cluster layout: entry-scoped communities → mini Sugiyama per cluster →
 * pack clusters on a grid with convex hulls and aggregated inter-cluster edges.
 */
import {
  aggregateClusterEdges,
  detectCommunities,
  labelCommunities,
  type LabeledCommunity,
} from './graph-clusters';
import type { GraphData, GraphIndex } from './graph-model';
import {
  NODE_H,
  NODE_W,
  layoutGraph,
  type EdgeGeometry,
  type LayoutResult,
  type NodePosition,
  type VisibleGraph,
} from './graph-layout';

export interface ClusterHull {
  id: string;
  label: string;
  subtitle: string;
  /** SVG path for the rounded hull */
  path: string;
  labelX: number;
  labelY: number;
  nodeIds: string[];
  colorIndex: number;
  /** axis-aligned bounds (for hit-testing) */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ClusterBridge {
  key: string;
  d: string;
  weight: number;
  sourceCluster: string;
  targetCluster: string;
  mid: { x: number; y: number };
}

export interface ClusterLayoutResult extends LayoutResult {
  clusters: ClusterHull[];
  clusterBridges: ClusterBridge[];
  communities: LabeledCommunity[];
  assignment: Map<string, string>;
}

const CLUSTER_PAD = 36;
const CLUSTER_GAP = 72;
const LABEL_H = 22;

/**
 * Build a clustered layout for the current visible graph.
 * Intra-cluster edges keep node-level geometry; inter-cluster deps become bridges.
 */
export function layoutClusteredGraph(
  view: VisibleGraph,
  index: GraphIndex,
  data: GraphData,
  nodeTags: ReadonlyMap<string, string[]>,
  resolution: number,
): ClusterLayoutResult {
  const part = detectCommunities(view, index, data, resolution);
  const communities = labelCommunities(part, data, nodeTags);

  if (!communities.length) {
    const empty = layoutGraph(view, index);
    return { ...empty, clusters: [], clusterBridges: [], communities: [], assignment: part.assignment };
  }

  const intraNodes = new Map<string, NodePosition>();
  const intraEdges: EdgeGeometry[] = [];
  const hulls: ClusterHull[] = [];

  const blocks = communities.map((community) => {
    const nodeSet = new Set(community.nodeIds);
    const edges = view.edges.filter((e) => nodeSet.has(e.source) && nodeSet.has(e.target));
    const hasIn = new Set(edges.map((e) => e.target));
    const roots = community.nodeIds.filter((id) => !hasIn.has(id));
    const localView: VisibleGraph = {
      roots: roots.length ? roots : community.nodeIds.slice(0, 1),
      nodes: nodeSet,
      edges,
    };
    const local = layoutGraph(localView, index);
    const w = Math.max(NODE_W, local.bbox.w) + CLUSTER_PAD * 2;
    const h = Math.max(NODE_H, local.bbox.h) + CLUSTER_PAD * 2 + LABEL_H;
    return { community, local, w, h };
  });

  const ordered = blocks.slice().sort((a, b) => b.w * b.h - a.w * a.h || a.community.id.localeCompare(b.community.id));
  const totalArea = ordered.reduce((s, b) => s + b.w * b.h, 0);
  const targetRowW = Math.max(ordered[0]?.w ?? 400, Math.sqrt(totalArea) * 1.35);

  let cursorX = 0;
  let cursorY = 0;
  let rowH = 0;
  const placed: { block: (typeof blocks)[0]; ox: number; oy: number }[] = [];

  ordered.forEach((block) => {
    if (cursorX > 0 && cursorX + block.w > targetRowW) {
      cursorX = 0;
      cursorY += rowH + CLUSTER_GAP;
      rowH = 0;
    }
    placed.push({ block, ox: cursorX, oy: cursorY });
    cursorX += block.w + CLUSTER_GAP;
    rowH = Math.max(rowH, block.h);
  });

  const centers = new Map<string, { x: number; y: number }>();

  placed.forEach(({ block, ox, oy }) => {
    const { community, local } = block;
    const contentOx = ox + CLUSTER_PAD;
    const contentOy = oy + CLUSTER_PAD + LABEL_H;

    local.nodes.forEach((p, id) => {
      intraNodes.set(id, { id, x: p.x + contentOx, y: p.y + contentOy, layer: p.layer });
    });
    local.edges.forEach((g) => {
      intraEdges.push({
        ...g,
        d: shiftSvgPath(g.d, contentOx, contentOy),
        mid: { x: g.mid.x + contentOx, y: g.mid.y + contentOy },
      });
    });

    const points: { x: number; y: number }[] = [];
    community.nodeIds.forEach((id) => {
      const p = intraNodes.get(id);
      if (!p) return;
      points.push(
        { x: p.x, y: p.y },
        { x: p.x + NODE_W, y: p.y },
        { x: p.x, y: p.y + NODE_H },
        { x: p.x + NODE_W, y: p.y + NODE_H },
      );
    });
    if (!points.length) {
      points.push(
        { x: ox + CLUSTER_PAD, y: oy + CLUSTER_PAD },
        { x: ox + block.w - CLUSTER_PAD, y: oy + block.h - CLUSTER_PAD },
      );
    }

    const pad = 18;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    points.forEach((p) => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
    minX -= pad;
    minY -= pad + 8;
    maxX += pad;
    maxY += pad;
    minY = Math.min(minY, oy + 8);

    const hullPts = convexHull(points);
    const expanded = expandHull(hullPts.length ? hullPts : rectCorners(minX, minY, maxX, maxY), 14);
    const path = roundedHullPath(expanded, 16);

    centers.set(community.id, { x: (minX + maxX) / 2, y: (minY + maxY) / 2 });

    hulls.push({
      id: community.id,
      label: community.label,
      subtitle: community.subtitle,
      path,
      labelX: minX + 10,
      labelY: minY + 16,
      nodeIds: community.nodeIds,
      colorIndex: community.colorIndex,
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
    });
  });

  const bridges: ClusterBridge[] = [];
  aggregateClusterEdges(view, part.assignment).forEach((agg) => {
    const s = centers.get(agg.source);
    const t = centers.get(agg.target);
    if (!s || !t) return;
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const dist = Math.hypot(dx, dy) || 1;
    const bend = Math.min(80, dist * 0.2);
    const nx = -dy / dist;
    const ny = dx / dist;
    const cx = (s.x + t.x) / 2 + nx * bend;
    const cy = (s.y + t.y) / 2 + ny * bend;
    bridges.push({
      key: `bridge:${agg.source}->${agg.target}`,
      d: `M${s.x},${s.y} Q${cx},${cy} ${t.x},${t.y}`,
      weight: agg.weight,
      sourceCluster: agg.source,
      targetCluster: agg.target,
      mid: { x: cx, y: cy },
    });
  });

  /* normalize so fitToView (origin-based) keeps working */
  let bboxW = NODE_W;
  let bboxH = NODE_H;
  if (hulls.length) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    hulls.forEach((h) => {
      minX = Math.min(minX, h.x);
      minY = Math.min(minY, h.y);
      maxX = Math.max(maxX, h.x + h.w);
      maxY = Math.max(maxY, h.y + h.h);
    });
    const originX = minX;
    const originY = minY;
    bboxW = Math.max(NODE_W, maxX - minX);
    bboxH = Math.max(NODE_H, maxY - minY);

    if (originX !== 0 || originY !== 0) {
      intraNodes.forEach((p, id) => {
        intraNodes.set(id, { ...p, x: p.x - originX, y: p.y - originY });
      });
      intraEdges.forEach((g, i) => {
        intraEdges[i] = {
          ...g,
          d: shiftSvgPath(g.d, -originX, -originY),
          mid: { x: g.mid.x - originX, y: g.mid.y - originY },
        };
      });
      hulls.forEach((h, i) => {
        hulls[i] = {
          ...h,
          path: shiftSvgPath(h.path, -originX, -originY),
          labelX: h.labelX - originX,
          labelY: h.labelY - originY,
          x: h.x - originX,
          y: h.y - originY,
        };
      });
      bridges.forEach((b, i) => {
        bridges[i] = {
          ...b,
          d: shiftSvgPath(b.d, -originX, -originY),
          mid: { x: b.mid.x - originX, y: b.mid.y - originY },
        };
      });
    }
  }

  return {
    nodes: intraNodes,
    edges: intraEdges,
    layers: [],
    bbox: { x: 0, y: 0, w: bboxW, h: bboxH },
    clusters: hulls,
    clusterBridges: bridges,
    communities,
    assignment: part.assignment,
  };
}

/** Translate an absolute SVG path (M/L/C/Q/Z) by (dx, dy). */
export function shiftSvgPath(d: string, dx: number, dy: number): string {
  const tokens = d.match(/[MLCQZmlcqz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  if (!tokens) return d;
  const out: string[] = [];
  let cmd = '';
  let nums: number[] = [];
  const flush = (): void => {
    if (!cmd) return;
    const pair = (i: number) => `${nums[i] + dx},${nums[i + 1] + dy}`;
    if (cmd === 'M' || cmd === 'L') {
      for (let i = 0; i + 1 < nums.length; i += 2) out.push(`${i === 0 ? cmd : 'L'}${pair(i)}`);
    } else if (cmd === 'C') {
      for (let i = 0; i + 5 < nums.length; i += 6) {
        out.push(`C${pair(i)} ${pair(i + 2)} ${pair(i + 4)}`);
      }
    } else if (cmd === 'Q') {
      for (let i = 0; i + 3 < nums.length; i += 4) {
        out.push(`Q${pair(i)} ${pair(i + 2)}`);
      }
    } else if (cmd === 'Z') {
      out.push('Z');
    }
    nums = [];
  };
  tokens.forEach((t) => {
    if (/^[MLCQZmlcqz]$/i.test(t)) {
      flush();
      cmd = t.toUpperCase();
    } else {
      nums.push(parseFloat(t));
    }
  });
  flush();
  return out.join(' ');
}

function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 1) return pts;
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: { x: number; y: number }[] = [];
  pts.forEach((p) => {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  });
  const upper: { x: number; y: number }[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function expandHull(pts: { x: number; y: number }[], pad: number): { x: number; y: number }[] {
  if (!pts.length) return pts;
  const c = pts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
  c.x /= pts.length;
  c.y /= pts.length;
  return pts.map((p) => {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * pad, y: p.y + (dy / len) * pad };
  });
}

function rectCorners(minX: number, minY: number, maxX: number, maxY: number): { x: number; y: number }[] {
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

function roundedHullPath(pts: { x: number; y: number }[], radius: number): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) {
    const p = pts[0];
    return `M${p.x - radius},${p.y} A${radius},${radius} 0 1 0 ${p.x + radius},${p.y} A${radius},${radius} 0 1 0 ${p.x - radius},${p.y} Z`;
  }
  if (pts.length === 2) {
    const [a, b] = pts;
    return `M${a.x},${a.y} L${b.x},${b.y} Z`;
  }
  const n = pts.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const v1x = cur.x - prev.x;
    const v1y = cur.y - prev.y;
    const v2x = next.x - cur.x;
    const v2y = next.y - cur.y;
    const len1 = Math.hypot(v1x, v1y) || 1;
    const len2 = Math.hypot(v2x, v2y) || 1;
    const r = Math.min(radius, len1 / 2, len2 / 2);
    const p1x = cur.x - (v1x / len1) * r;
    const p1y = cur.y - (v1y / len1) * r;
    const p2x = cur.x + (v2x / len2) * r;
    const p2y = cur.y + (v2y / len2) * r;
    if (i === 0) d += `M${p1x},${p1y}`;
    else d += `L${p1x},${p1y}`;
    d += ` Q${cur.x},${cur.y} ${p2x},${p2y}`;
  }
  return d + ' Z';
}
