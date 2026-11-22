import { describe, expect, it } from "vitest";
import type { ShapeView } from "@canvas/doc";
import { Scene } from "./scene";

const shape = (id: string, x = 0): ShapeView => ({ id, kind: "rect", x, y: 0, w: 10, h: 10, fill: 0 });

describe("Scene", () => {
  it("ignores a patch that is older than the latest local edit (no snap-back while dragging)", () => {
    const scene = new Scene();
    scene.addLocal([shape("a", 0)], 1);
    scene.updateLocal([{ id: "a", patch: { x: 10 } }], 2);
    scene.updateLocal([{ id: "a", patch: { x: 20 } }], 3);

    scene.applyPatch({ type: "patch", seq: 2, upserts: [shape("a", 10)], removes: [], engineMs: 0 });
    expect(scene.get("a")?.x).toBe(20); // stale echo of seq 2 ignored

    scene.applyPatch({ type: "patch", seq: 3, upserts: [shape("a", 20)], removes: [], engineMs: 0 });
    expect(scene.get("a")?.x).toBe(20);
  });

  it("accepts patches for shapes with no newer local edit", () => {
    const scene = new Scene();
    scene.applyPatch({ type: "patch", seq: 5, upserts: [shape("a", 7)], removes: [], order: ["a"], engineMs: 0 });
    expect(scene.get("a")?.x).toBe(7);
    expect(scene.ids()).toEqual(["a"]);
  });

  it("tracks dirty shapes and order changes for the renderer", () => {
    const scene = new Scene();
    scene.addLocal([shape("a"), shape("b")], 1);
    expect([...scene.dirty]).toEqual(["a", "b"]);
    expect(scene.orderDirty).toBe(true);
    scene.removeLocal(["a"]);
    expect(scene.ordered().map((s) => s.id)).toEqual(["b"]);
  });
});
