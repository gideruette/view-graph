/**
 * Folder-tree rendering of the same community partition the Clusters view already computes
 * (see cluster-layout.ts) — cluster -> directory -> sub-directory -> file, each level foldable.
 */
import type { LabeledCommunity } from './graph-clusters';
import type { GraphData } from './graph-model';

export interface TreeDirNode {
  /** `${clusterId}::${dirPath}` — globally unique, used as the expand/collapse state key. */
  key: string;
  /** Compacted display segment, e.g. "app/core" when a chain has no branching. */
  name: string;
  dirs: TreeDirNode[];
  /** Nodes whose file lives directly in this directory (sorted by name). */
  nodeIds: string[];
  /** Total node count in this subtree, for the row badge. */
  count: number;
}

export interface ClusterTree {
  id: string;
  label: string;
  subtitle: string;
  root: TreeDirNode;
}

interface TrieNode {
  name: string;
  children: Map<string, TrieNode>;
  nodeIds: string[];
}

function newTrieNode(name: string): TrieNode {
  return { name, children: new Map(), nodeIds: [] };
}

function splitDir(file: string | null): string[] {
  if (!file) return [];
  const segments = file.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments.slice(0, -1);
}

/** Merges a run of single-child, leaf-less directories into one display row. */
function toDirNode(trie: TrieNode, clusterId: string, dirPath: string[], data: GraphData): TreeDirNode {
  let node = trie;
  const nameParts = [node.name];
  let path = dirPath;
  while (node.nodeIds.length === 0 && node.children.size === 1) {
    const [childName, child] = [...node.children.entries()][0];
    node = child;
    nameParts.push(childName);
    path = [...path, childName];
  }

  const dirs = [...node.children.entries()]
    .map(([childName, child]) => toDirNode(child, clusterId, [...path, childName], data))
    .sort((a, b) => a.name.localeCompare(b.name));
  const nodeIds = node.nodeIds
    .slice()
    .sort((a, b) => (data.byId.get(a)?.name ?? a).localeCompare(data.byId.get(b)?.name ?? b));
  const count = nodeIds.length + dirs.reduce((s, d) => s + d.count, 0);

  return {
    key: `${clusterId}::${path.join('/')}`,
    name: nameParts.join('/'),
    dirs,
    nodeIds,
    count,
  };
}

export function buildClusterTrees(communities: LabeledCommunity[], data: GraphData): ClusterTree[] {
  return communities.map((community) => {
    const trie = newTrieNode('');
    community.nodeIds.forEach((id) => {
      const n = data.byId.get(id);
      const dirSegments = splitDir(n?.file ?? null);
      let cur = trie;
      dirSegments.forEach((seg) => {
        let next = cur.children.get(seg);
        if (!next) {
          next = newTrieNode(seg);
          cur.children.set(seg, next);
        }
        cur = next;
      });
      cur.nodeIds.push(id);
    });

    const dirs = [...trie.children.entries()]
      .map(([name, child]) => toDirNode(child, community.id, [name], data))
      .sort((a, b) => a.name.localeCompare(b.name));
    const rootNodeIds = trie.nodeIds
      .slice()
      .sort((a, b) => (data.byId.get(a)?.name ?? a).localeCompare(data.byId.get(b)?.name ?? b));
    const count = rootNodeIds.length + dirs.reduce((s, d) => s + d.count, 0);

    return {
      id: community.id,
      label: community.label,
      subtitle: community.subtitle,
      root: { key: community.id, name: '', dirs, nodeIds: rootNodeIds, count },
    };
  });
}

function collectFrom(node: TreeDirNode, out: string[]): void {
  out.push(node.key);
  node.dirs.forEach((d) => collectFrom(d, out));
}

/** Cluster id + every nested directory key — used to collapse a whole tree at once. */
export function collectDirKeys(tree: ClusterTree): string[] {
  const out = [tree.id];
  tree.root.dirs.forEach((d) => collectFrom(d, out));
  return out;
}
