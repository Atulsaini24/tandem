import { parsePoints, type NodeId, type ShapeView } from "@canvas/doc";
import type { Point } from "./viewport";

/**
 * Shape geometry in world coordinates, shared by hit-testing, the renderer, snapping and
 * export, so all of them agree on where a rotated shape or an attached arrow really is.
 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export type Lookup = (id: NodeId) => ShapeView | undefined;

/** Frames are hit on their title strip and border only, so you can still marquee inside them. */
export const FRAME_TITLE_H = 28;
const FRAME_EDGE = 10;

export const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export function rotate(p: Point, around: Point, angle: number): Point {
  if (angle === 0) return p;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p.x - around.x;
  const dy = p.y - around.y;
  return { x: around.x + dx * cos - dy * sin, y: around.y + dx * sin + dy * cos };
}

/** The four corners of a (possibly rotated) shape, clockwise from top-left. */
export function corners(s: ShapeView): Point[] {
  const c = center(s);
  const r = s.rotation ?? 0;
  return [
    { x: s.x, y: s.y },
    { x: s.x + s.w, y: s.y },
    { x: s.x + s.w, y: s.y + s.h },
    { x: s.x, y: s.y + s.h },
  ].map((p) => rotate(p, c, r));
}

export const isLine = (s: ShapeView): boolean => s.kind === "arrow";

/** The point where a ray from the shape's center toward `toward` leaves its outline. */
export function boundaryPoint(s: ShapeView, toward: Point, gap = 6): Point {
  const c = center(s);
  const r = s.rotation ?? 0;
  const local = rotate(toward, c, -r);
  const dx = local.x - c.x;
  const dy = local.y - c.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return c;
  const ux = dx / len;
  const uy = dy / len;
  const rx = s.w / 2;
  const ry = s.h / 2;
  let t: number;
  if (s.kind === "ellipse") t = 1 / Math.sqrt((ux * ux) / (rx * rx) + (uy * uy) / (ry * ry));
  else if (s.kind === "diamond") t = 1 / (Math.abs(ux) / rx + Math.abs(uy) / ry);
  else t = Math.min(Math.abs(ux) > 1e-9 ? rx / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-9 ? ry / Math.abs(uy) : Infinity);
  const d = Math.min(len, t + gap);
  return rotate({ x: c.x + ux * d, y: c.y + uy * d }, c, r);
}

/** Free endpoints stored on an arrow (normalized to its box). */
function freeEnds(arrow: ShapeView): { a: Point; b: Point } {
  const pts = parsePoints(arrow.points);
  const p0 = pts[0] ?? { x: 0, y: 0 };
  const p1 = pts[pts.length - 1] ?? { x: 1, y: 1 };
  return {
    a: { x: arrow.x + p0.x * arrow.w, y: arrow.y + p0.y * arrow.h },
    b: { x: arrow.x + p1.x * arrow.w, y: arrow.y + p1.y * arrow.h },
  };
}

/**
 * Where an arrow's two ends really are. An end attached to a shape sits on that shape's
 * outline, aimed at the other end, so it follows the shape as it moves.
 */
export function arrowEnds(arrow: ShapeView, lookup: Lookup): { a: Point; b: Point } {
  const free = freeEnds(arrow);
  const from = arrow.from ? lookup(arrow.from) : undefined;
  const to = arrow.to ? lookup(arrow.to) : undefined;
  const aim = { a: from ? center(from) : free.a, b: to ? center(to) : free.b };
  return {
    a: from ? boundaryPoint(from, aim.b) : free.a,
    b: to ? boundaryPoint(to, aim.a) : free.b,
  };
}

/** Box + normalized points for an arrow running from a to b. */
export function arrowBox(a: Point, b: Point): { x: number; y: number; w: number; h: number; points: string } {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.max(1, Math.abs(a.x - b.x));
  const h = Math.max(1, Math.abs(a.y - b.y));
  const n = (p: Point): string => `${Math.round(((p.x - x) / w) * 10_000) / 10_000},${Math.round(((p.y - y) / h) * 10_000) / 10_000}`;
  return { x, y, w, h, points: `${n(a)} ${n(b)}` };
}

/** A pen stroke's points in world coordinates (rotation applied). */
export function pathPoints(s: ShapeView): Point[] {
  const c = center(s);
  const r = s.rotation ?? 0;
  return parsePoints(s.points).map((p) => rotate({ x: s.x + p.x * s.w, y: s.y + p.y * s.h }, c, r));
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Is `p` on the shape? `tolerance` (world units) widens thin things like lines. */
export function containsPoint(s: ShapeView, p: Point, lookup: Lookup, tolerance = 6): boolean {
  if (s.kind === "arrow") {
    const { a, b } = arrowEnds(s, lookup);
    return distanceToSegment(p, a, b) <= tolerance + 2;
  }
  if (s.kind === "path") {
    const pts = pathPoints(s);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (a && b && distanceToSegment(p, a, b) <= tolerance + 3) return true;
    }
    return pts.length === 1 && pts[0] !== undefined && Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= tolerance + 3;
  }
  const local = rotate(p, center(s), -(s.rotation ?? 0));
  if (s.kind === "frame") {
    const inTitle = local.x >= s.x && local.x <= s.x + s.w && local.y >= s.y - FRAME_TITLE_H && local.y <= s.y;
    if (inTitle) return true;
    const inOuter = local.x >= s.x - FRAME_EDGE / 2 && local.x <= s.x + s.w + FRAME_EDGE / 2 && local.y >= s.y - FRAME_EDGE / 2 && local.y <= s.y + s.h + FRAME_EDGE / 2;
    const inInner = local.x > s.x + FRAME_EDGE && local.x < s.x + s.w - FRAME_EDGE && local.y > s.y + FRAME_EDGE && local.y < s.y + s.h - FRAME_EDGE;
    return inOuter && !inInner;
  }
  if (local.x < s.x || local.y < s.y || local.x > s.x + s.w || local.y > s.y + s.h) return false;
  const rx = s.w / 2;
  const ry = s.h / 2;
  const dx = (local.x - (s.x + rx)) / rx;
  const dy = (local.y - (s.y + ry)) / ry;
  if (s.kind === "ellipse") return dx * dx + dy * dy <= 1;
  if (s.kind === "diamond") return Math.abs(dx) + Math.abs(dy) <= 1;
  return true;
}

/** Topmost shape under the point. `shapes` is back to front. */
export function hitTest(shapes: readonly ShapeView[], p: Point, lookup: Lookup, tolerance = 6): NodeId | undefined {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i];
    if (shape && containsPoint(shape, p, lookup, tolerance)) return shape.id;
  }
  return undefined;
}

/** Axis-aligned bounds of what's actually drawn (rotation and attached arrow ends included). */
export function visualBounds(s: ShapeView, lookup: Lookup): Rect {
  if (s.kind === "arrow") {
    const { a, b } = arrowEnds(s, lookup);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(1, Math.abs(a.x - b.x)), h: Math.max(1, Math.abs(a.y - b.y)) };
  }
  if (!s.rotation) return s.kind === "frame" ? { x: s.x, y: s.y - FRAME_TITLE_H, w: s.w, h: s.h + FRAME_TITLE_H } : s;
  return boundsOfPoints(corners(s)) ?? s;
}

export function boundsOfPoints(points: readonly Point[]): Rect | undefined {
  if (points.length === 0) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function boundsOf(rects: readonly Rect[]): Rect | undefined {
  if (rects.length === 0) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of rects) {
    minX = Math.min(minX, s.x);
    minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x + s.w);
    maxY = Math.max(maxY, s.y + s.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

export const containsRect = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/** Marquee selection: every shape whose drawn bounds touch the rectangle. */
export function shapesInRect(shapes: readonly ShapeView[], r: Rect, lookup: Lookup): NodeId[] {
  return shapes.filter((shape) => intersects(visualBounds(shape, lookup), r)).map((shape) => shape.id);
}

// --- transform handles --------------------------------------------------------

export type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate" | "start" | "end";

/** Unit position of each resize handle on the box (0..1). */
export const RESIZE_HANDLES: ReadonlyArray<{ id: HandleId; u: number; v: number }> = [
  { id: "nw", u: 0, v: 0 },
  { id: "n", u: 0.5, v: 0 },
  { id: "ne", u: 1, v: 0 },
  { id: "e", u: 1, v: 0.5 },
  { id: "se", u: 1, v: 1 },
  { id: "s", u: 0.5, v: 1 },
  { id: "sw", u: 0, v: 1 },
  { id: "w", u: 0, v: 0.5 },
];

export const ROTATE_OFFSET_PX = 26;

/** Handle positions (world) for a box with rotation; the rotate knob sits above the top edge. */
export function handlePositions(box: Rect, rotation: number, zoom: number): Array<{ id: HandleId; p: Point }> {
  const c = center(box);
  const out = RESIZE_HANDLES.map((h) => ({ id: h.id, p: rotate({ x: box.x + h.u * box.w, y: box.y + h.v * box.h }, c, rotation) }));
  out.push({ id: "rotate", p: rotate({ x: c.x, y: box.y - ROTATE_OFFSET_PX / zoom }, c, rotation) });
  return out;
}

/**
 * Resize a box by dragging handle `id` to world point `p`, in the box's own (rotated)
 * frame. The opposite edge/corner stays fixed. `keepAspect` locks proportions.
 */
export function resizeBox(box: Rect, rotation: number, id: HandleId, p: Point, keepAspect: boolean, min = 8): Rect {
  const handle = RESIZE_HANDLES.find((h) => h.id === id);
  if (!handle) return box;
  const c = center(box);
  const local = rotate(p, c, -rotation);
  // Fixed anchor = the opposite handle, in local (unrotated) coordinates.
  const ax = box.x + (1 - handle.u) * box.w;
  const ay = box.y + (1 - handle.v) * box.h;
  let x0 = box.x;
  let x1 = box.x + box.w;
  let y0 = box.y;
  let y1 = box.y + box.h;
  if (handle.u !== 0.5) [x0, x1] = handle.u === 0 ? [Math.min(local.x, ax - min), ax] : [ax, Math.max(local.x, ax + min)];
  if (handle.v !== 0.5) [y0, y1] = handle.v === 0 ? [Math.min(local.y, ay - min), ay] : [ay, Math.max(local.y, ay + min)];
  let w = x1 - x0;
  let h = y1 - y0;
  if (keepAspect && handle.u !== 0.5 && handle.v !== 0.5) {
    const ratio = box.w / box.h;
    if (w / h > ratio) h = w / ratio;
    else w = h * ratio;
    x0 = handle.u === 0 ? ax - w : ax;
    y0 = handle.v === 0 ? ay - h : ay;
  }
  // The anchor must stay put on screen: re-center so the rotated anchor doesn't drift.
  const next = { x: x0, y: y0, w, h };
  if (rotation === 0) return next;
  const anchorBefore = rotate({ x: ax, y: ay }, c, rotation);
  const nc = center(next);
  const anchorAfter = rotate({ x: ax, y: ay }, nc, rotation);
  return { x: x0 + anchorBefore.x - anchorAfter.x, y: y0 + anchorBefore.y - anchorAfter.y, w, h };
}

/** Quick-connect "+" handles: just outside the middle of each side (rotation included). */
export const QUICK_CONNECT_KINDS = new Set(["rect", "ellipse", "diamond"]);
export function quickConnectPoints(s: ShapeView, zoom: number): Array<{ side: "n" | "e" | "s" | "w"; p: Point }> {
  if (!QUICK_CONNECT_KINDS.has(s.kind)) return [];
  const c = center(s);
  const off = 26 / zoom;
  const r = s.rotation ?? 0;
  const pts: Array<{ side: "n" | "e" | "s" | "w"; p: Point }> = [
    { side: "n", p: { x: c.x, y: s.y - off } },
    { side: "e", p: { x: s.x + s.w + off, y: c.y } },
    { side: "s", p: { x: c.x, y: s.y + s.h + off } },
    { side: "w", p: { x: s.x - off, y: c.y } },
  ];
  return pts.map(({ side, p }) => ({ side, p: rotate(p, c, r) }));
}
