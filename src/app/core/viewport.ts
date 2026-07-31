/** Pure pan/zoom/fit math for the SVG canvas — no DOM, no Angular. */
import { clamp } from './utils';

export const KMIN = 0.02;
export const KMAX = 3.2;

export interface Rect {
  width: number;
  height: number;
}

export interface Bbox {
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ViewportTransform {
  x: number;
  y: number;
  k: number;
}

/** Fits the whole layout bbox inside the visible rect, matching fitToView() from the former engine. */
export function computeFit(bbox: Bbox, rect: Rect): ViewportTransform {
  const pad = 46;
  if (!bbox.w || !bbox.h) return { x: rect.width / 2, y: 60, k: 1 };
  const k = clamp(Math.min((rect.width - pad * 2) / bbox.w, (rect.height - pad * 2) / bbox.h), KMIN, 1.25);
  const x = (rect.width - bbox.w * k) / 2;
  const y = Math.max(pad * 0.6, (rect.height - bbox.h * k) / 2);
  return { x, y, k };
}

/** Zooms by `factor` around `center` (screen-space point), matching zoomBy(). */
export function computeZoom(view: ViewportTransform, factor: number, center: Point): ViewportTransform {
  const k0 = view.k;
  const k1 = clamp(k0 * factor, KMIN, KMAX);
  if (k1 === k0) return view;
  const x = center.x - (center.x - view.x) * (k1 / k0);
  const y = center.y - (center.y - view.y) * (k1 / k0);
  return { x, y, k: k1 };
}

/** Centers the viewport on a graph-space point at the current zoom level, matching centerOn(). */
export function computeCenterOn(nodeCenter: Point, rect: Rect, k: number): ViewportTransform {
  return { x: rect.width / 2 - nodeCenter.x * k, y: rect.height / 2 - nodeCenter.y * k, k };
}
