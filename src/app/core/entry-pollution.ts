/**
 * Stack mix per entry point — how much of what an entry point reaches is owned by a stack other
 * than the one owning most of it.
 *
 *   pollution = (attributed − largest stack) / attributed
 *
 * The minority side rather than any single named stack, because the question the number answers is
 * whether an entry point can be owned, tested or migrated inside one stack, and that is symmetric:
 * a mostly-React screen holding on to three Angular components is as entangled as the reverse. With
 * two stacks it reduces to `min / total` and is bounded at 50%; with three or more it keeps meaning
 * "the share that is not the majority".
 *
 * Nothing here names a stack. The stacks are whichever `tech:` tags the loaded graph carries
 * (SCHEMA.md § Tags), so an Angular+React extract, a Spring+C# one, or a merge of both are all read
 * the same way — and a single-stack graph has no mix to report, which is why the UI hides the
 * dashboard below two.
 */
import { nodeSub, subtreeOf, type GraphData, type GraphIndex } from './graph-model';

/** Which nodes the mix is measured over. */
export type PollutionScope = 'ui' | 'all';

/**
 * The cross-stack `type:` tags for a visual unit. Every UI stack has components, views and layouts,
 * so counting only those compares like with like; `all` widens to every typed node, which pulls in
 * the service and data layers a screen happens to reach.
 */
const UI_TYPE_TAGS: ReadonlySet<string> = new Set(['type:component', 'type:view', 'type:layout']);

const TECH_PREFIX = 'tech:';
const TYPE_PREFIX = 'type:';

/** One stack's weight inside a measured reach. */
export interface StackCount {
  tech: string;
  /** The part after `tech:` — what the table column shows. */
  label: string;
  count: number;
  /** Percentage of the *attributed* nodes, so the stack shares add up to 100. */
  share: number;
}

export interface PollutionMix {
  /** Counted nodes in the measured reach, whatever stack owns them. */
  total: number;
  /** Counted nodes owned by exactly one stack — the only ones a mix can be read from. */
  attributed: number;
  /** Counted nodes several stacks claim: shared code, not pollution chargeable to either. */
  shared: number;
  /** Counted nodes no stack claims. */
  unattributed: number;
  stacks: StackCount[];
  /** The `tech:` tag holding the most attributed nodes, or null when none is attributed. */
  dominant: string | null;
  /** Percentage of `attributed` not held by `dominant`, or null when nothing is attributed. */
  pollution: number | null;
}

export interface EntryPollution extends PollutionMix {
  id: string;
  name: string;
  sub: string;
}

export interface PollutionReport {
  scope: PollutionScope;
  /** Every `tech:` tag the graph carries, most-used first — the columns of the table. */
  techTags: string[];
  /** One row per *measurable* entry point, most polluted first. */
  rows: EntryPollution[];
  /** The same measurement over every node, rather than one entry point's reach. */
  overall: PollutionMix;
  /**
   * Entry points left out of `rows` because they reach nothing countable — a leaf screen with no
   * children of its own. Listing them at 0% would read as "clean" rather than "not measured".
   */
  unmeasuredCount: number;
  /** Rows drawing on more than one stack. */
  mixedCount: number;
}

/** Display name of a stack: `tech:angular` → `angular`. */
export function stackLabel(tech: string): string {
  return tech.startsWith(TECH_PREFIX) ? tech.slice(TECH_PREFIX.length) || tech : tech;
}

function isCounted(tags: readonly string[], scope: PollutionScope): boolean {
  if (scope === 'ui') return tags.some((t) => UI_TYPE_TAGS.has(t));
  return tags.some((t) => t.startsWith(TYPE_PREFIX));
}

function mixOf(
  ids: Iterable<string>,
  data: GraphData,
  tagsOf: (id: string) => readonly string[],
  scope: PollutionScope,
  techTags: readonly string[],
): PollutionMix {
  const perStack = new Map<string, number>(techTags.map((t) => [t, 0]));
  let total = 0;
  let shared = 0;
  let unattributed = 0;

  for (const id of ids) {
    if (!data.byId.has(id)) continue;
    const tags = tagsOf(id);
    if (!isCounted(tags, scope)) continue;
    total++;
    const owners = tags.filter((t) => t.startsWith(TECH_PREFIX));
    if (!owners.length) unattributed++;
    else if (owners.length > 1) shared++;
    else perStack.set(owners[0], (perStack.get(owners[0]) ?? 0) + 1);
  }

  const attributed = total - shared - unattributed;
  const stacks = techTags.map((tech) => {
    const count = perStack.get(tech) ?? 0;
    return { tech, label: stackLabel(tech), count, share: attributed ? (100 * count) / attributed : 0 };
  });

  /* A tie leaves `dominant` on the first stack by graph-wide frequency; the pollution figure is
   * unaffected, since it only needs the size of the largest share. */
  let dominant: string | null = null;
  let largest = 0;
  for (const s of stacks) {
    if (s.count <= largest) continue;
    largest = s.count;
    dominant = s.tech;
  }

  return {
    total,
    attributed,
    shared,
    unattributed,
    stacks,
    dominant: attributed ? dominant : null,
    pollution: attributed ? (100 * (attributed - largest)) / attributed : null,
  };
}

/** `tech:` tags present in the graph, most-used first so the busiest stack leads the table. */
function techTagsOf(data: GraphData, tagsOf: (id: string) => readonly string[]): string[] {
  const counts = new Map<string, number>();
  data.nodes.forEach((n) => {
    tagsOf(n.id).forEach((t) => {
      if (t.startsWith(TECH_PREFIX)) counts.set(t, (counts.get(t) ?? 0) + 1);
    });
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

/**
 * Measures every entry point in `data`. Reachable sets overlap by design — a shared component
 * counts for each entry point that reaches it — so the rows do not partition the graph and their
 * totals are not meant to add up.
 */
export function computeEntryPollution(
  data: GraphData,
  index: GraphIndex,
  tagsOf: (id: string) => readonly string[],
  scope: PollutionScope,
): PollutionReport {
  const techTags = techTagsOf(data, tagsOf);

  const rows: EntryPollution[] = [];
  let unmeasuredCount = 0;
  for (const id of data.entryPoints) {
    const reach = subtreeOf(index, id);
    reach.delete(id); // an entry point measures what it drags in, not itself
    const mix = mixOf(reach, data, tagsOf, scope, techTags);
    if (!mix.attributed) {
      unmeasuredCount++;
      continue;
    }
    const node = data.byId.get(id);
    rows.push({ id, name: node?.name ?? id, sub: nodeSub(node), ...mix });
  }
  rows.sort((a, b) => (b.pollution ?? 0) - (a.pollution ?? 0) || b.attributed - a.attributed || a.name.localeCompare(b.name));

  return {
    scope,
    techTags,
    rows,
    overall: mixOf(
      data.nodes.map((n) => n.id),
      data,
      tagsOf,
      scope,
      techTags,
    ),
    unmeasuredCount,
    mixedCount: rows.filter((r) => (r.pollution ?? 0) > 0).length,
  };
}
