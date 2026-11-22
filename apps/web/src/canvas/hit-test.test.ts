import { describe, expect, it } from "vitest";
import type { ShapeView } from "@canvas/doc";
import { boundsOf, containsPoint, hitTest, rectFromPoints, shapesInRect } from "./hit-test";

const rect: ShapeView = { id: "r", kind: "rect", x: 0, y: 0, w: 100, h: 50, fill: 0 };
const ellipse: ShapeView = { id: "e", kind: "ellipse", x: 0, y: 0, w: 100, h: 50, fill: 0 };

describe("hit testing", () => {
  it("hits rectangles anywhere inside their bounds", () => {
    expect(containsPoint(rect, { x: 1, y: 1 })).toBe(true);
    expect(containsPoint(rect, { x: 101, y: 1 })).toBe(false);
  });

  it("hits ellipses exactly, not their bounding-box corners", () => {
    expect(containsPoint(ellipse, { x: 50, y: 25 })).toBe(true);
    expect(containsPoint(ellipse, { x: 2, y: 2 })).toBe(false); // corner of the bbox
  });

  it("returns the topmost shape", () => {
    const top: ShapeView = { ...rect, id: "top", x: 40 };
    expect(hitTest([rect, top], { x: 50, y: 10 })).toBe("top");
    expect(hitTest([rect, top], { x: 10, y: 10 })).toBe("r");
    expect(hitTest([rect, top], { x: 500, y: 500 })).toBeUndefined();
  });

  it("marquee-selects shapes that touch the rectangle, dragged in any direction", () => {
    const far: ShapeView = { ...rect, id: "far", x: 1000, y: 1000 };
    expect(shapesInRect([rect, far], rectFromPoints({ x: 120, y: 60 }, { x: 90, y: 40 }))).toEqual(["r"]);
  });

  it("computes the bounds of a selection", () => {
    expect(boundsOf([rect, { ...rect, x: 200, y: -10 }])).toEqual({ x: 0, y: -10, w: 300, h: 60 });
    expect(boundsOf([])).toBeUndefined();
  });
});
