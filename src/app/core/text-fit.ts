/** Pixel-accurate text truncation (canvas measureText) for SVG labels that don't wrap. */
let ctx: CanvasRenderingContext2D | null | undefined;

function measureCtx(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx;
  try {
    ctx = document.createElement('canvas').getContext('2d');
  } catch {
    ctx = null;
  }
  return ctx;
}

export function fitText(text: string, font: string, maxW: number): string {
  const t = text ?? '';
  const mctx = measureCtx();
  if (!mctx) return t.length > 26 ? `${t.slice(0, 25)}…` : t;
  mctx.font = font;
  if (mctx.measureText(t).width <= maxW) return t;
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (mctx.measureText(`${t.slice(0, mid)}…`).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return `${t.slice(0, Math.max(1, lo))}…`;
}

export const FONT_NAME = '650 12.5px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const FONT_SUB = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
