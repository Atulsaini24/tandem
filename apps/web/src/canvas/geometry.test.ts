import { describe, expect, it } from "vitest";
import type { ShapeView } from "@canvas/doc";
import { arrowBox, arrowEnds, boundsOf, containsPoint, hitTest, rectFromPoints, resizeBox, shapesInRect, visualBounds } from "./geometry";

const rect: ShapeView = { id: "r", kind: "rect", x: 0, y: 0, w: 100, h: 50, fill: 0 };
const ellipse: ShapeView = { id: "e", kind: "ellipse", x: 0, y: 0, w: 100, h: 50, fill: 0 };
const none = (): undefined => undefined;

describe("hit testing", () => {
  it("hits rectangles anywhere inside their bounds", () => {
    expect(containsPoint(rect, { x: 1, y: 1 }, none)).toBe(true);
    expect(containsPoint(rect, { x: 101, y: 1 }, none)).toBe(false);
  });

  it("hits ellipses and diamonds exactly, not their bounding-box corners", () => {
    expect(containsPoint(ellipse, { x: 50, y: 25 }, none)).toBe(true);
    expect(containsPoint(ellipse, { x: 2, y: 2 }, none)).toBe(false);
    expect(containsPoint({ ...rect, kind: "diamond" }, { x: 5, y: 5 }, none)).toBe(false);
    expect(containsPoint({ ...rect, kind: "diamond" }, { x: 50, y: 25 }, none)).toBe(true);
  });

  it("accounts for rotation", () => {
    const tall: ShapeView = { ...rect, rotation: Math.PI / 2 }; // 100x50 turned upright around (50,25)
    expect(containsPoint(tall, { x: 5, y: 25 }, none)).toBe(false);
    expect(containsPoint(tall, { x: 50, y: -15 }, none)).toBe(true);
    expect(visualBounds(tall, none)).toMatchObject({ w: expect.closeTo(50, 5), h: expect.closeTo(100, 5) });
  });

  it("returns the topmost shape", () => {
    const top: ShapeView = { ...rect, id: "top", x: 40 };
    expect(hitTest([rect, top], { x: 50, y: 10 }, none)).toBe("top");
    expect(hitTest([rect, top], { x: 10, y: 10 }, none)).toBe("r");
    expect(hitTest([rect, top], { x: 500, y: 500 }, none)).toBeUndefined();
  });

  it("frames are hit on their title and border, not their inside", () => {
    const frame: ShapeView = { ...rect, kind: "frame", w: 400, h: 300 };
    expect(containsPoint(frame, { x: 200, y: 150 }, none)).toBe(false);
    expect(containsPoint(frame, { x: 200, y: -10 }, none)).toBe(true);
    expect(containsPoint(frame, { x: 2, y: 150 }, none)).toBe(true);
  });

  it("marquee-selects shapes that touch the rectangle, dragged in any direction", () => {
    const far: ShapeView = { ...rect, id: "far", x: 1000, y: 1000 };
    expect(shapesInRect([rect, far], rectFromPoints({ x: 120, y: 60 }, { x: 90, y: 40 }), none)).toEqual(["r"]);
  });

  it("computes the bounds of a selection", () => {
    expect(boundsOf([rect, { ...rect, x: 200, y: -10 }])).toEqual({ x: 0, y: -10, w: 300, h: 60 });
    expect(boundsOf([])).toBeUndefined();
  });
});

describe("arrows", () => {
  it("attached ends sit on the outline of their shapes and follow them", () => {
    const a: ShapeView = { ...rect, id: "a" };
    const b: ShapeView = { ...rect, id: "b", x: 300 };
    const arrow: ShapeView = { id: "x", kind: "arrow", ...arrowBox({ x: 0, y: 0 }, { x: 10, y: 10 }), fill: 0, from: "a", to: "b" };
    const lookup = (id: string): ShapeView | undefined => ({ a, b })[id as "a" | "b"];
    const ends = arrowEnds(arrow, lookup);
    expect(ends.a.x).toBeCloseTo(106);
    expect(ends.b.x).toBeCloseTo(294);
    expect(ends.a.y).toBeCloseTo(25);
    expect(containsPoint(arrow, { x: 200, y: 26 }, lookup)).toBe(true);
    expect(containsPoint(arrow, { x: 200, y: 60 }, lookup)).toBe(false);
  });

  it("free ends round-trip through the normalized box", () => {
    const box = arrowBox({ x: 50, y: 80 }, { x: 10, y: 20 });
    const ends = arrowEnds({ id: "x", kind: "arrow", ...box, fill: 0 }, none);
    expect(ends.a).toEqual({ x: 50, y: 80 });
    expect(ends.b).toEqual({ x: 10, y: 20 });
  });
});

describe("resizing", () => {
  it("keeps the opposite corner fixed", () => {
    expect(resizeBox(rect, 0, "se", { x: 200, y: 100 }, false)).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    expect(resizeBox(rect, 0, "nw", { x: -50, y: -50 }, false)).toEqual({ x: -50, y: -50, w: 150, h: 100 });
    expect(resizeBox(rect, 0, "e", { x: 300, y: 999 }, false)).toEqual({ x: 0, y: 0, w: 300, h: 50 });
  });

  it("locks the aspect ratio with shift and never inverts", () => {
    const next = resizeBox(rect, 0, "se", { x: 400, y: 60 }, true);
    expect(next.w / next.h).toBeCloseTo(2);
    expect(resizeBox(rect, 0, "se", { x: -500, y: -500 }, false).w).toBe(8);
  });
});
