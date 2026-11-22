import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { MAX_ZOOM, MIN_ZOOM, screenToWorld, stepZoom, worldToScreen, zoomTo, type Viewport } from "./viewport";

const viewportArb: fc.Arbitrary<Viewport> = fc.record({
  x: fc.double({ min: -1e4, max: 1e4, noNaN: true }),
  y: fc.double({ min: -1e4, max: 1e4, noNaN: true }),
  zoom: fc.double({ min: MIN_ZOOM, max: MAX_ZOOM, noNaN: true }),
});
const pointArb = fc.record({
  x: fc.double({ min: -1e4, max: 1e4, noNaN: true }),
  y: fc.double({ min: -1e4, max: 1e4, noNaN: true }),
});

describe("viewport", () => {
  it("screenToWorld and worldToScreen are inverses", () => {
    fc.assert(
      fc.property(viewportArb, pointArb, (v, p) => {
        const back = worldToScreen(v, screenToWorld(v, p));
        expect(back.x).toBeCloseTo(p.x, 6);
        expect(back.y).toBeCloseTo(p.y, 6);
      }),
    );
  });

  it("zooming keeps the world point under the cursor fixed", () => {
    fc.assert(
      fc.property(viewportArb, pointArb, fc.double({ min: MIN_ZOOM, max: MAX_ZOOM, noNaN: true }), (v, anchor, zoom) => {
        const before = screenToWorld(v, anchor);
        const after = screenToWorld(zoomTo(v, anchor, zoom), anchor);
        expect(after.x).toBeCloseTo(before.x, 4);
        expect(after.y).toBeCloseTo(before.y, 4);
      }),
    );
  });

  it("clamps zoom", () => {
    const v = { x: 0, y: 0, zoom: 1 };
    expect(zoomTo(v, { x: 0, y: 0 }, 1e6).zoom).toBe(MAX_ZOOM);
    expect(zoomTo(v, { x: 0, y: 0 }, 1e-6).zoom).toBe(MIN_ZOOM);
  });

  it("animated zoom converges to the target and keeps its anchor", () => {
    let v: Viewport = { x: 100, y: 50, zoom: 1 };
    const anchor = { x: 400, y: 300 };
    const world = screenToWorld(v, anchor);
    for (let frame = 0; frame < 120; frame++) v = stepZoom(v, 4, anchor, 1000 / 60);
    expect(v.zoom).toBe(4);
    expect(screenToWorld(v, anchor).x).toBeCloseTo(world.x, 6);
  });

  it("animation is frame-rate independent", () => {
    const anchor = { x: 0, y: 0 };
    let at60: Viewport = { x: 0, y: 0, zoom: 1 };
    let at120: Viewport = at60;
    for (let i = 0; i < 6; i++) at60 = stepZoom(at60, 8, anchor, 1000 / 60);
    for (let i = 0; i < 12; i++) at120 = stepZoom(at120, 8, anchor, 1000 / 120);
    expect(at120.zoom).toBeCloseTo(at60.zoom, 6);
  });
});
