/**
 * Viewport math. Pure functions, so they're unit-tested without a browser.
 *
 *   screen = world * zoom + (x, y)
 */
export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 16;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function screenToWorld(v: Viewport, p: Point): Point {
  return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom };
}

export function worldToScreen(v: Viewport, p: Point): Point {
  return { x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y };
}

export function panBy(v: Viewport, dx: number, dy: number): Viewport {
  return { ...v, x: v.x + dx, y: v.y + dy };
}

/** Set the zoom while keeping the world point under `anchor` (a screen point) fixed. */
export function zoomTo(v: Viewport, anchor: Point, zoom: number): Viewport {
  const z = clampZoom(zoom);
  const world = screenToWorld(v, anchor);
  return { zoom: z, x: anchor.x - world.x * z, y: anchor.y - world.y * z };
}

/**
 * One animation step toward `target` zoom, anchored at `anchor`.
 *
 * Interpolates in log space (zooming 1→2 should feel like 2→4) with exponential
 * smoothing: t = 1 − e^(−k·dt). That is frame-rate independent: the same motion at
 * 60Hz and 144Hz. Snaps when within 0.1%.
 */
export function stepZoom(v: Viewport, target: number, anchor: Point, dtMs: number, stiffness = 16): Viewport {
  const goal = clampZoom(target);
  const t = 1 - Math.exp((-stiffness * dtMs) / 1000);
  const logZoom = Math.log(v.zoom) + (Math.log(goal) - Math.log(v.zoom)) * t;
  const zoom = Math.abs(Math.exp(logZoom) - goal) / goal < 1e-3 ? goal : Math.exp(logZoom);
  return zoomTo(v, anchor, zoom);
}
