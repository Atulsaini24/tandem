import type { NodeId, ShapeView } from "@canvas/doc";
import type { Point } from "./viewport";

/**
 * Hit testing in world coordinates. Pixi's event system is turned off: walking
 * 5,000 display objects per pointer move costs more than this plain loop, and
 * owning the geometry means exact ellipse hits instead of bounding boxes.
 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export function containsPoint(shape: ShapeView, p: Point): boolean {
  if (p.x < shape.x || p.y < shape.y || p.x > shape.x + shape.w || p.y > shape.y + shape.h) return false;
  if (shape.kind === "rect") return true;
  const rx = shape.w / 2;
  const ry = shape.h / 2;
  const dx = (p.x - (shape.x + rx)) / rx;
  const dy = (p.y - (shape.y + ry)) / ry;
  return dx * dx + dy * dy <= 1;
}

/** Topmost shape under the point. `shapes` is back to front. */
export function hitTest(shapes: readonly ShapeView[], p: Point): NodeId | undefined {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i];
    if (shape && containsPoint(shape, p)) return shape.id;
  }
  return undefined;
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function intersects(shape: Rect, r: Rect): boolean {
  return shape.x <= r.x + r.w && shape.x + shape.w >= r.x && shape.y <= r.y + r.h && shape.y + shape.h >= r.y;
}

/** Marquee selection: every shape whose bounds touch the rectangle. */
export function shapesInRect(shapes: readonly ShapeView[], r: Rect): NodeId[] {
  return shapes.filter((shape) => intersects(shape, r)).map((shape) => shape.id);
}

export function boundsOf(shapes: readonly Rect[]): Rect | undefined {
  if (shapes.length === 0) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of shapes) {
    minX = Math.min(minX, s.x);
    minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x + s.w);
    maxY = Math.max(maxY, s.y + s.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
