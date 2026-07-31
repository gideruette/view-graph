/** Small framework-agnostic helpers shared by the graph core modules. */

export function isArr(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

export function arr(v: unknown): unknown[] {
  return isArr(v) ? v : [];
}

export function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

export function num(v: unknown): number | null {
  return typeof v === 'number' && isFinite(v) ? v : null;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function uniq<T>(a: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const v of a) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

export function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${n === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}

export function basename(p: string | null | undefined): string {
  const s = str(p);
  if (!s) return '';
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i >= 0 ? s.slice(i + 1) : s;
}

export interface EdgeLike {
  source: string;
  target: string;
}

export function edgeKey(e: EdgeLike): string {
  return `${e.source}\0${e.target}`;
}

/** True when a drag event carries at least one OS file (vs. a text/internal drag). */
export function isFileDrag(dt: DataTransfer | null | undefined): boolean {
  if (!dt || !dt.types) return false;
  return Array.prototype.indexOf.call(dt.types, 'Files') >= 0;
}
