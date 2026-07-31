/**
 * Dependency-graph domain model — SCHEMA.md v4 (nodes/edges/entryPoints subset).
 * Pure, framework-agnostic port of the validation + indexing logic that used to
 * live in engine/viewer-engine.js (normalize / buildIndex / traversal helpers).
 */
import { arr, edgeKey, isArr, num, str, uniq } from './utils';

export interface GraphNode {
  id: string;
  name: string;
  file: string | null;
  kind: string | null;
  /** Free-form extractor labels used for bulk hide / bulk colour (SCHEMA.md § Tags). Always deduped, never null. */
  tags: string[];
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphMeta {
  tech: string | null;
  label: string | null;
  root: string | null;
  warnings: string[];
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  entryPointCount: number;
  orphanCount: number;
  maxDepth: number;
}

export interface GraphData {
  version: 4;
  generatedAt: string | null;
  meta: GraphMeta;
  entryPoints: string[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
  byId: Map<string, GraphNode>;
}

export interface NormalizeResult {
  data: GraphData | null;
  errors: string[];
  warnings: string[];
}

export interface GraphIndex {
  out: Map<string, GraphEdge[]>;
  inn: Map<string, GraphEdge[]>;
  byKey: Map<string, GraphEdge>;
  backEdges: Set<string>;
  cyclicNodes: Set<string>;
  reach: Set<string>;
  depth: Map<string, number>;
  maxDepth: number;
}

/** Validates + normalizes a raw parsed JSON payload against SCHEMA.md v4. */
export function normalizeGraph(raw: unknown): NormalizeResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const bad = (m: string) => errors.push(m);
  const warn = (m: string) => {
    if (warnings.length < 200) warnings.push(m);
  };

  if (raw == null || typeof raw !== 'object' || isArr(raw)) {
    bad('Top level must be a JSON object.');
    return { data: null, errors, warnings };
  }
  const rawObj = raw as Record<string, unknown>;
  const version = num(rawObj['version']);
  if (version !== 4) {
    bad(`SCHEMA.md v4 required (got version ${version == null ? 'missing' : version}).`);
    return { data: null, errors, warnings };
  }
  const rawNodes = rawObj['nodes'];
  if (!isArr(rawNodes) || !rawNodes.length) {
    bad('`nodes` must be a non-empty array.');
    return { data: null, errors, warnings };
  }
  if (rawObj['edges'] != null && !isArr(rawObj['edges'])) {
    warn('`edges` is not an array — treating as empty.');
  }

  const rawMeta = rawObj['meta'];
  const metaRaw: Record<string, unknown> =
    rawMeta && typeof rawMeta === 'object' && !isArr(rawMeta) ? (rawMeta as Record<string, unknown>) : {};
  if (rawMeta != null && (typeof rawMeta !== 'object' || isArr(rawMeta))) {
    warn('`meta` is not an object — ignored.');
  }

  const byId = new Map<string, GraphNode>();
  const nodes: GraphNode[] = [];
  rawNodes.forEach((rn, i) => {
    if (rn == null || typeof rn !== 'object') {
      warn(`nodes[${i}] is not an object — dropped.`);
      return;
    }
    const rnObj = rn as Record<string, unknown>;
    const id = str(rnObj['id']);
    if (!id) {
      warn(`nodes[${i}] has no \`id\` — dropped.`);
      return;
    }
    if (byId.has(id)) {
      warn(`Duplicate node id "${id}" — later copy dropped.`);
      return;
    }
    const rawTags = rnObj['tags'];
    if (rawTags != null && !isArr(rawTags)) warn(`nodes[${i}].tags is not an array — ignored.`);
    const n: GraphNode = {
      id,
      name: str(rnObj['name']) || id,
      file: rnObj['file'] == null ? null : str(rnObj['file']),
      kind: str(rnObj['kind']) || null,
      tags: uniq(
        arr(rawTags)
          .map((t) => str(t).trim())
          .filter(Boolean),
      ),
    };
    byId.set(id, n);
    nodes.push(n);
  });
  if (!nodes.length) {
    bad('No usable node survived validation.');
    return { data: null, errors, warnings };
  }

  const edges: GraphEdge[] = [];
  const seenEdge = new Set<string>();
  arr(rawObj['edges']).forEach((re, i) => {
    if (re == null || typeof re !== 'object') {
      warn(`edges[${i}] is not an object — dropped.`);
      return;
    }
    const reObj = re as Record<string, unknown>;
    const s = str(reObj['source']);
    const t = str(reObj['target']);
    if (!byId.has(s)) {
      warn(`edges[${i}]: unknown source "${s}" — dropped.`);
      return;
    }
    if (!byId.has(t)) {
      warn(`edges[${i}]: unknown target "${t}" — dropped.`);
      return;
    }
    const k = `${s}\0${t}`;
    if (seenEdge.has(k)) {
      warn(`Duplicate edge ${s} → ${t} — dropped.`);
      return;
    }
    seenEdge.add(k);
    edges.push({ source: s, target: t });
  });

  /* Collapse resolved shared "contract" nodes (SCHEMA.md § multi-extract reconciliation) into
   * direct dependency edges. Once a contract has both a provider (a backend controller — the
   * only side that emits kind:"controller") and at least one consumer, the contract node itself
   * adds nothing a `consumer → provider` edge doesn't already convey; left in place it reads as a
   * dead-end (or a spurious root) instead of an ordinary dependency. Contracts with only one side
   * present (no known provider yet, or no consumer) stay visible — that gap is the point of the
   * reconciliation view.
   *
   * The backend extractor also routes the endpoint method's own direct calls through the contract
   * (`contract → serviceMethod`, not `endpointMethod → serviceMethod`) so descent through a merged
   * graph flows from the contract outward. Collapsing must reroute those as `provider → serviceMethod`
   * — dropping the contract's outgoing edges outright would sever the entry point from everything it
   * calls, not just remove the now-redundant contract node. */
  const contractIncoming = new Map<string, GraphEdge[]>();
  const contractOutgoing = new Map<string, GraphEdge[]>();
  edges.forEach((e) => {
    if (byId.get(e.target)?.kind === 'contract') {
      if (!contractIncoming.has(e.target)) contractIncoming.set(e.target, []);
      contractIncoming.get(e.target)!.push(e);
    }
    if (byId.get(e.source)?.kind === 'contract') {
      if (!contractOutgoing.has(e.source)) contractOutgoing.set(e.source, []);
      contractOutgoing.get(e.source)!.push(e);
    }
  });
  const resolvedContracts = new Set<string>();
  const collapsedEdges: GraphEdge[] = [];
  contractIncoming.forEach((incoming, contractId) => {
    const providers = uniq(incoming.filter((e) => byId.get(e.source)?.kind === 'controller').map((e) => e.source));
    const consumers = uniq(incoming.filter((e) => byId.get(e.source)?.kind !== 'controller').map((e) => e.source));
    if (!providers.length || !consumers.length) return;
    resolvedContracts.add(contractId);
    consumers.forEach((c) => providers.forEach((p) => collapsedEdges.push({ source: c, target: p })));
    const passThrough = contractOutgoing.get(contractId) ?? [];
    passThrough.forEach((e) => providers.forEach((p) => collapsedEdges.push({ source: p, target: e.target })));
  });
  if (resolvedContracts.size) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (resolvedContracts.has(nodes[i].id)) {
        byId.delete(nodes[i].id);
        nodes.splice(i, 1);
      }
    }
    const survivors = edges.filter((e) => !resolvedContracts.has(e.source) && !resolvedContracts.has(e.target));
    edges.length = 0;
    edges.push(...survivors);
    collapsedEdges.forEach((e) => {
      if (e.source === e.target) return;
      const k = `${e.source}\0${e.target}`;
      if (seenEdge.has(k)) return;
      seenEdge.add(k);
      edges.push(e);
    });
  }

  let eps = arr(rawObj['entryPoints'])
    .map(str)
    .filter((id) => {
      if (!byId.has(id)) {
        warn(`entryPoints: unknown id "${id}" — dropped.`);
        return false;
      }
      return true;
    });
  eps = uniq(eps);
  if (!eps.length) {
    warn('No entry points — using nodes with no incoming edges.');
    const hasIn = new Set(edges.map((e) => e.target));
    nodes.forEach((n) => {
      if (!hasIn.has(n.id)) eps.push(n.id);
    });
    if (!eps.length) eps.push(nodes[0].id);
  }

  const meta: GraphMeta = {
    tech: str(metaRaw['tech']) || null,
    label: str(metaRaw['label']) || null,
    root: str(metaRaw['root']) || null,
    warnings: arr(metaRaw['warnings']).map(str).filter(Boolean),
  };
  meta.warnings.forEach((w) => warnings.push(`extractor: ${w}`));

  /* reachability + orphans */
  const outTmp = new Map<string, string[]>();
  nodes.forEach((n) => outTmp.set(n.id, []));
  edges.forEach((e) => outTmp.get(e.source)!.push(e.target));
  const reached = new Set<string>();
  const q = eps.slice();
  eps.forEach((id) => reached.add(id));
  while (q.length) {
    const v = q.shift()!;
    (outTmp.get(v) ?? []).forEach((t) => {
      if (!reached.has(t)) {
        reached.add(t);
        q.push(t);
      }
    });
  }
  const orphanCount = nodes.filter((n) => !reached.has(n.id)).length;

  /* BFS depth (first visit) — cycles must not inflate forever */
  const depth = new Map<string, number>();
  let maxDepth = 0;
  const dq = eps.slice();
  eps.forEach((id) => depth.set(id, 0));
  while (dq.length) {
    const id = dq.shift()!;
    const d = depth.get(id) ?? 0;
    (outTmp.get(id) ?? []).forEach((t) => {
      if (depth.has(t)) return;
      const nd = d + 1;
      depth.set(t, nd);
      if (nd > maxDepth) maxDepth = nd;
      dq.push(t);
    });
  }

  const rawStats = rawObj['stats'];
  const rs: Record<string, unknown> =
    rawStats && typeof rawStats === 'object' && !isArr(rawStats) ? (rawStats as Record<string, unknown>) : {};
  const stats: GraphStats = {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    entryPointCount: eps.length,
    orphanCount,
    maxDepth,
  };
  (['nodeCount', 'edgeCount', 'entryPointCount', 'orphanCount', 'maxDepth'] as const).forEach((k) => {
    if (rs[k] != null && num(rs[k]) !== stats[k]) {
      warn(`stats.${k} says ${rs[k]} but computed ${stats[k]} — using computed.`);
    }
  });

  return {
    data: {
      version: 4,
      generatedAt: str(rawObj['generatedAt']) || null,
      meta,
      entryPoints: eps,
      nodes,
      edges,
      stats,
      byId,
    },
    errors,
    warnings,
  };
}

/** Builds the adjacency / reachability / cycle index used by every graph query. */
export function buildGraphIndex(d: GraphData): GraphIndex {
  const out = new Map<string, GraphEdge[]>();
  const inn = new Map<string, GraphEdge[]>();
  const byKey = new Map<string, GraphEdge>();
  d.nodes.forEach((n) => {
    out.set(n.id, []);
    inn.set(n.id, []);
  });
  d.edges.forEach((e) => {
    out.get(e.source)!.push(e);
    inn.get(e.target)!.push(e);
    byKey.set(edgeKey(e), e);
  });

  /* DFS back edges from entry points (then every remaining node) */
  const color = new Map<string, number>();
  const backEdges = new Set<string>();
  const cyclicNodes = new Set<string>();
  function dfs(startId: string): void {
    if (color.get(startId)) return;
    const st: [string, number][] = [[startId, 0]];
    color.set(startId, 1);
    while (st.length) {
      const f = st[st.length - 1];
      const v = f[0];
      const es = out.get(v) ?? [];
      let pushed = false;
      while (f[1] < es.length) {
        const e = es[f[1]];
        f[1]++;
        const c = color.get(e.target) ?? 0;
        if (c === 1) {
          backEdges.add(edgeKey(e));
          cyclicNodes.add(e.source);
          cyclicNodes.add(e.target);
        } else if (c === 0) {
          color.set(e.target, 1);
          st.push([e.target, 0]);
          pushed = true;
          break;
        }
      }
      if (!pushed) {
        color.set(v, 2);
        st.pop();
      }
    }
  }
  d.entryPoints.forEach(dfs);
  d.nodes.forEach((n) => dfs(n.id));

  const reach = new Set<string>();
  const rq = d.entryPoints.slice();
  d.entryPoints.forEach((id) => reach.add(id));
  while (rq.length) {
    const rv = rq.shift()!;
    (out.get(rv) ?? []).forEach((e) => {
      if (!reach.has(e.target)) {
        reach.add(e.target);
        rq.push(e.target);
      }
    });
  }

  const depth = new Map<string, number>();
  const dq = d.entryPoints.slice();
  d.entryPoints.forEach((id) => depth.set(id, 0));
  while (dq.length) {
    const v = dq.shift()!;
    const dp = depth.get(v) ?? 0;
    (out.get(v) ?? []).forEach((e) => {
      if (backEdges.has(edgeKey(e))) return;
      if (depth.has(e.target)) return;
      depth.set(e.target, dp + 1);
      dq.push(e.target);
    });
  }
  let maxDepth = 0;
  depth.forEach((v) => {
    if (v > maxDepth) maxDepth = v;
  });

  return { out, inn, byKey, backEdges, cyclicNodes, reach, depth, maxDepth };
}

export function outEdges(index: GraphIndex, id: string): GraphEdge[] {
  return index.out.get(id) ?? [];
}

export function inEdges(index: GraphIndex, id: string): GraphEdge[] {
  return index.inn.get(id) ?? [];
}

export function childCount(index: GraphIndex, id: string): number {
  return outEdges(index, id).length;
}

export function orphanIds(data: GraphData, index: GraphIndex): string[] {
  return data.nodes.filter((n) => !index.reach.has(n.id)).map((n) => n.id);
}

/**
 * Grows a set of explicitly-hidden nodes into everything that disappears with them: the seeds plus
 * the descendants that were only reachable *through* a seed ("node + its exclusive subtree" — hiding
 * a whole layer prunes the branches it fed, but keeps nodes another live path still reaches).
 * Orphans are never pruned indirectly (they hang off no path), only when seeded themselves.
 */
export function hiddenClosureFrom(data: GraphData, index: GraphIndex, seeds: ReadonlySet<string>): Set<string> {
  const hidden = new Set<string>(seeds);
  if (!hidden.size) return hidden;

  const alive = new Set<string>();
  const q: string[] = [];
  data.entryPoints.forEach((id) => {
    if (hidden.has(id) || alive.has(id)) return;
    alive.add(id);
    q.push(id);
  });
  while (q.length) {
    const v = q.shift()!;
    outEdges(index, v).forEach((e) => {
      if (hidden.has(e.target) || alive.has(e.target)) return;
      alive.add(e.target);
      q.push(e.target);
    });
  }
  index.reach.forEach((id) => {
    if (!alive.has(id)) hidden.add(id);
  });
  return hidden;
}

export function subtreeOf(index: GraphIndex, rootId: string): Set<string> {
  const seen = new Set<string>([rootId]);
  const q = [rootId];
  let guard = 0;
  while (q.length && guard++ < 100000) {
    const v = q.shift()!;
    outEdges(index, v).forEach((e) => {
      if (seen.has(e.target)) return;
      seen.add(e.target);
      q.push(e.target);
    });
  }
  return seen;
}

/** Restrict scope = the node itself, everything it (transitively) depends on, and everything that
 *  (transitively) depends on it — not just its descendant subtree. Works for any node, not only
 *  declared entry points: a leaf (e.g. a repository) has no descendants but plenty of ancestors. */
export function inEntryScope(index: GraphIndex, entryRoot: string | null, id: string): boolean {
  if (!entryRoot) return true;
  return subtreeOf(index, entryRoot).has(id) || ancestorsOf(index, null, entryRoot).has(id);
}

export function ancestorsOf(index: GraphIndex, entryRoot: string | null, id: string): Set<string> {
  const seen = new Set<string>([id]);
  const q = [id];
  let guard = 0;
  while (q.length && guard++ < 100000) {
    const v = q.shift()!;
    if (entryRoot && v === entryRoot) continue;
    inEdges(index, v).forEach((e) => {
      if (seen.has(e.source)) return;
      seen.add(e.source);
      q.push(e.source);
    });
  }
  seen.delete(id);
  return seen;
}

export function descendantsWithDepth(index: GraphIndex, id: string): Map<string, number> {
  const depth = new Map<string, number>();
  const q = [id];
  const seen = new Set<string>([id]);
  let guard = 0;
  while (q.length && guard++ < 100000) {
    const v = q.shift()!;
    const d0 = v === id ? 0 : (depth.get(v) ?? 0);
    outEdges(index, v).forEach((e) => {
      if (seen.has(e.target)) return;
      seen.add(e.target);
      depth.set(e.target, d0 + 1);
      q.push(e.target);
    });
  }
  return depth;
}

export function pathFromEntries(
  data: GraphData,
  index: GraphIndex,
  entryRoot: string | null,
  target: string,
): string[] | null {
  const prev = new Map<string, string>();
  const q: string[] = [];
  const seen = new Set<string>();
  const starts = entryRoot ? [entryRoot] : data.entryPoints;
  starts.forEach((id) => {
    seen.add(id);
    q.push(id);
  });
  if (seen.has(target)) return [target];
  let guard = 0;
  while (q.length && guard++ < 100000) {
    const v = q.shift()!;
    const es = outEdges(index, v);
    for (const e of es) {
      const t = e.target;
      if (seen.has(t)) continue;
      seen.add(t);
      prev.set(t, v);
      if (t === target) {
        const path = [t];
        let c = t;
        while (prev.has(c)) {
          c = prev.get(c)!;
          path.unshift(c);
        }
        return path;
      }
      q.push(t);
    }
  }
  return null;
}

/** Built-in demo dataset shown when no extract has been loaded yet. */
export function demoData(): unknown {
  return {
    version: 4,
    generatedAt: new Date().toISOString(),
    meta: {
      tech: 'demo',
      label: 'demo-app',
      root: 'src',
      warnings: ['Built-in demo dataset — not your project.'],
    },
    entryPoints: ['app', 'admin'],
    nodes: [
      { id: 'app', name: 'AppShell', file: 'app/shell.ts', kind: 'layout', tags: ['tech:angular', 'type:layout'] },
      { id: 'admin', name: 'AdminPage', file: 'pages/admin.ts', kind: 'view', tags: ['tech:angular', 'type:view'] },
      { id: 'table', name: 'DataTable', file: 'ui/table.ts', kind: 'component', tags: ['tech:angular', 'type:component'] },
      { id: 'form', name: 'EditForm', file: 'ui/form.ts', kind: 'component', tags: ['tech:angular', 'type:component'] },
      { id: 'orphan', name: 'LegacyUtil', file: 'util/legacy.ts', kind: 'model', tags: ['tech:angular', 'type:entity'] },
    ],
    edges: [
      { source: 'app', target: 'table' },
      { source: 'admin', target: 'form' },
      { source: 'form', target: 'table' },
      { source: 'table', target: 'form' },
    ],
    stats: {
      nodeCount: 5,
      edgeCount: 4,
      entryPointCount: 2,
      orphanCount: 1,
      maxDepth: 2,
    },
  };
}

/**
 * Kinds the viewer has a dedicated colour for. Anything else renders as `k-unknown` — `kind` is
 * free-form by contract, so this is a presentation allow-list, never a validation rule.
 * `model` and `entity` are the same data layer under two emitter spellings.
 */
const KNOWN_KINDS = new Set([
  'view',
  'layout',
  'component',
  'model',
  'entity',
  'service',
  'pipe',
  'directive',
  'contract',
]);

export function kindClass(k: string | null | undefined): string {
  const kk = str(k) || 'unknown';
  return KNOWN_KINDS.has(kk) ? kk : 'unknown';
}

export function nodeSub(n: GraphNode | null | undefined): string {
  if (!n) return '';
  if (n.kind) return n.kind;
  return str(n.file) ? n.file!.split(/[/\\]/).pop()! : n.id;
}
