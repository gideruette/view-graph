import { Injectable } from '@angular/core';

/** Plain SCHEMA.md v4 entry tree node (serializable). */
export interface ViewGraphEntryJson {
  id: string;
  label: string;
  path?: string | null;
  nodeId?: string | null;
  children?: ViewGraphEntryJson[];
}

/** Plain SCHEMA.md v4 document (serializable — no Maps). */
export interface ViewGraphDocument {
  version: 4;
  generatedAt?: string;
  meta?: {
    tech?: string | null;
    label?: string | null;
    root?: string | null;
    warnings?: string[];
  };
  entryPoints: string[];
  entries?: ViewGraphEntryJson[];
  nodes: Array<{
    id: string;
    name: string;
    file?: string | null;
    kind?: string | null;
    tags?: string[];
  }>;
  edges: Array<{ source: string; target: string }>;
  stats?: {
    nodeCount: number;
    edgeCount: number;
    entryPointCount: number;
    orphanCount: number;
    maxDepth: number;
  };
}

export interface ViewGraphMergeResult {
  document: ViewGraphDocument;
  warnings: string[];
}

/**
 * Merges two (or more) SCHEMA.md v4 extracts into one document.
 * Join key = `nodes[].id` (shared contracts). See SCHEMA « Multi-extract reconciliation ».
 */
@Injectable({ providedIn: 'root' })
export class ViewGraphMergeService {
  /** Merge exactly two extracts (A then B). */
  merge(a: unknown, b: unknown): ViewGraphMergeResult {
    return this.mergeAll([a, b]);
  }

  /** Merge N extracts in order (first wins on conflicting non-empty name/kind). */
  mergeAll(rawDocs: unknown[]): ViewGraphMergeResult {
    const warnings: string[] = [];
    if (!rawDocs.length) {
      throw new Error('mergeAll: at least one extract is required');
    }

    const docs = rawDocs.map((raw, i) => this.asDocument(raw, i, warnings));

    const nodes = new Map<string, ViewGraphDocument['nodes'][number]>();
    for (const doc of docs) {
      for (const n of doc.nodes) {
        const prev = nodes.get(n.id);
        if (!prev) {
          nodes.set(n.id, { ...n });
          continue;
        }
        nodes.set(n.id, this.mergeNode(prev, n, warnings));
      }
    }

    const edgeKeys = new Set<string>();
    const edges: ViewGraphDocument['edges'] = [];
    for (const doc of docs) {
      for (const e of doc.edges) {
        if (!nodes.has(e.source) || !nodes.has(e.target)) {
          warnings.push(`Dropped edge ${e.source} → ${e.target} (endpoint missing after merge).`);
          continue;
        }
        const k = `${e.source}\0${e.target}`;
        if (edgeKeys.has(k)) continue;
        edgeKeys.add(k);
        edges.push({ source: e.source, target: e.target });
      }
    }

    const entryPoints: string[] = [];
    const epSeen = new Set<string>();
    for (const doc of docs) {
      for (const id of doc.entryPoints) {
        if (!nodes.has(id)) {
          warnings.push(`Dropped entryPoint "${id}" (unknown node after merge).`);
          continue;
        }
        if (epSeen.has(id)) continue;
        epSeen.add(id);
        entryPoints.push(id);
      }
    }

    const entryIds = new Set<string>();
    const entries: ViewGraphEntryJson[] = [];
    for (const doc of docs) {
      for (const root of doc.entries ?? []) {
        entries.push(this.adoptEntryTree(root, nodes, entryIds, warnings));
      }
    }

    const labels = docs.map((d) => d.meta?.label).filter((x): x is string => !!x);
    const extractorWarnings = docs.flatMap((d) => d.meta?.warnings ?? []);

    const nodeList = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
    edges.sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));

    const stats = this.computeStats(nodeList, edges, entryPoints);

    const document: ViewGraphDocument = {
      version: 4,
      generatedAt: new Date().toISOString(),
      meta: {
        tech: 'merged',
        label: labels.length ? labels.join('+') : null,
        warnings: [...extractorWarnings, ...warnings],
      },
      entryPoints,
      entries: entries.length ? entries : undefined,
      nodes: nodeList,
      edges,
      stats,
    };

    return { document, warnings };
  }

  private asDocument(raw: unknown, index: number, warnings: string[]): ViewGraphDocument {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`Extract #${index + 1} is not a JSON object`);
    }
    const o = raw as Record<string, unknown>;
    if (o['version'] !== 4) {
      throw new Error(`Extract #${index + 1} must be SCHEMA v4 (got version ${String(o['version'])})`);
    }
    if (!Array.isArray(o['nodes']) || !o['nodes'].length) {
      throw new Error(`Extract #${index + 1} has no nodes`);
    }

    const nodes: ViewGraphDocument['nodes'] = [];
    const byId = new Set<string>();
    for (const rn of o['nodes'] as unknown[]) {
      if (rn == null || typeof rn !== 'object') continue;
      const n = rn as Record<string, unknown>;
      const id = typeof n['id'] === 'string' ? n['id'] : '';
      if (!id || byId.has(id)) continue;
      byId.add(id);
      const tags = Array.isArray(n['tags'])
        ? [...new Set((n['tags'] as unknown[]).filter((t): t is string => typeof t === 'string' && !!t.trim()).map((t) => t.trim()))]
        : [];
      nodes.push({
        id,
        name: typeof n['name'] === 'string' && n['name'] ? n['name'] : id,
        file: typeof n['file'] === 'string' ? n['file'] : null,
        kind: typeof n['kind'] === 'string' ? n['kind'] : null,
        tags,
      });
    }
    if (!nodes.length) {
      throw new Error(`Extract #${index + 1} has no usable nodes`);
    }

    const edges: ViewGraphDocument['edges'] = [];
    const ek = new Set<string>();
    if (Array.isArray(o['edges'])) {
      for (const re of o['edges'] as unknown[]) {
        if (re == null || typeof re !== 'object') continue;
        const e = re as Record<string, unknown>;
        const source = typeof e['source'] === 'string' ? e['source'] : '';
        const target = typeof e['target'] === 'string' ? e['target'] : '';
        if (!source || !target || !byId.has(source) || !byId.has(target)) continue;
        const k = `${source}\0${target}`;
        if (ek.has(k)) continue;
        ek.add(k);
        edges.push({ source, target });
      }
    }

    const entryPoints = Array.isArray(o['entryPoints'])
      ? [...new Set((o['entryPoints'] as unknown[]).filter((x): x is string => typeof x === 'string' && byId.has(x)))]
      : [];

    const metaRaw =
      o['meta'] && typeof o['meta'] === 'object' && !Array.isArray(o['meta'])
        ? (o['meta'] as Record<string, unknown>)
        : {};

    const entries = Array.isArray(o['entries'])
      ? (o['entries'] as unknown[]).map((e, i) => this.readEntry(e, `extract#${index + 1}.entries[${i}]`, warnings)).filter((e): e is ViewGraphEntryJson => !!e)
      : [];

    return {
      version: 4,
      generatedAt: typeof o['generatedAt'] === 'string' ? o['generatedAt'] : undefined,
      meta: {
        tech: typeof metaRaw['tech'] === 'string' ? metaRaw['tech'] : null,
        label: typeof metaRaw['label'] === 'string' ? metaRaw['label'] : null,
        root: typeof metaRaw['root'] === 'string' ? metaRaw['root'] : null,
        warnings: Array.isArray(metaRaw['warnings'])
          ? metaRaw['warnings'].filter((w): w is string => typeof w === 'string')
          : [],
      },
      entryPoints,
      entries,
      nodes,
      edges,
    };
  }

  private mergeNode(
    a: ViewGraphDocument['nodes'][number],
    b: ViewGraphDocument['nodes'][number],
    warnings: string[],
  ): ViewGraphDocument['nodes'][number] {
    const out = { ...a };
    if (!out.name && b.name) out.name = b.name;
    if (!out.file && b.file) out.file = b.file;
    if (!out.kind && b.kind) out.kind = b.kind;
    /* Tags are additive, not conflicting: a shared contract legitimately carries both sides' labels. */
    out.tags = [...new Set([...(a.tags ?? []), ...(b.tags ?? [])])];
    if (a.name && b.name && a.name !== b.name) {
      warnings.push(`Node "${a.id}": conflicting name "${a.name}" vs "${b.name}" — kept "${a.name}".`);
    }
    if (a.kind && b.kind && a.kind !== b.kind) {
      warnings.push(`Node "${a.id}": conflicting kind "${a.kind}" vs "${b.kind}" — kept "${a.kind}".`);
    }
    return out;
  }

  private readEntry(raw: unknown, hint: string, warnings: string[]): ViewGraphEntryJson | null {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
      warnings.push(`${hint} is not an object — dropped.`);
      return null;
    }
    const o = raw as Record<string, unknown>;
    const id = typeof o['id'] === 'string' ? o['id'] : '';
    if (!id) {
      warnings.push(`${hint} has no id — dropped.`);
      return null;
    }
    const label = typeof o['label'] === 'string' && o['label'] ? o['label'] : id;
    const children = Array.isArray(o['children'])
      ? (o['children'] as unknown[])
          .map((c, i) => this.readEntry(c, `${hint}.children[${i}]`, warnings))
          .filter((c): c is ViewGraphEntryJson => !!c)
      : [];
    return {
      id,
      label,
      path: typeof o['path'] === 'string' ? o['path'] : null,
      nodeId: typeof o['nodeId'] === 'string' ? o['nodeId'] : null,
      children: children.length ? children : undefined,
    };
  }

  private adoptEntryTree(
    entry: ViewGraphEntryJson,
    nodes: Map<string, ViewGraphDocument['nodes'][number]>,
    usedIds: Set<string>,
    warnings: string[],
  ): ViewGraphEntryJson {
    let id = entry.id;
    if (usedIds.has(id)) {
      let i = 2;
      while (usedIds.has(`${entry.id}~${i}`)) i++;
      id = `${entry.id}~${i}`;
      warnings.push(`Remapped duplicate entry id "${entry.id}" → "${id}".`);
    }
    usedIds.add(id);

    let nodeId = entry.nodeId ?? null;
    if (nodeId && !nodes.has(nodeId)) {
      warnings.push(`entries "${id}": unknown nodeId "${nodeId}" — cleared.`);
      nodeId = null;
    }
    const children = (entry.children ?? []).map((c) => this.adoptEntryTree(c, nodes, usedIds, warnings));
    return {
      id,
      label: entry.label,
      path: entry.path ?? null,
      nodeId,
      children: children.length ? children : undefined,
    };
  }

  private computeStats(
    nodes: ViewGraphDocument['nodes'],
    edges: ViewGraphDocument['edges'],
    entryPoints: string[],
  ): NonNullable<ViewGraphDocument['stats']> {
    const out = new Map<string, string[]>();
    for (const n of nodes) out.set(n.id, []);
    for (const e of edges) out.get(e.source)?.push(e.target);

    const eps = entryPoints.length
      ? entryPoints
      : nodes.filter((n) => !edges.some((e) => e.target === n.id)).map((n) => n.id);

    const reached = new Set<string>();
    const q = [...eps];
    eps.forEach((id) => reached.add(id));
    while (q.length) {
      const v = q.pop()!;
      for (const t of out.get(v) ?? []) {
        if (reached.has(t)) continue;
        reached.add(t);
        q.push(t);
      }
    }

    const depth = new Map<string, number>();
    const dq = [...eps];
    eps.forEach((id) => depth.set(id, 0));
    let maxDepth = 0;
    while (dq.length) {
      const id = dq.shift()!;
      const d = depth.get(id) ?? 0;
      for (const t of out.get(id) ?? []) {
        if (depth.has(t)) continue;
        const nd = d + 1;
        depth.set(t, nd);
        if (nd > maxDepth) maxDepth = nd;
        dq.push(t);
      }
    }

    return {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      entryPointCount: eps.length,
      orphanCount: nodes.filter((n) => !reached.has(n.id)).length,
      maxDepth,
    };
  }
}
