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

    scene.applyPatch({ type: "patch", seq: 2, upserts: [shape("a", 10)], removes: [], engineMs: 0, remote: false });
    expect(scene.get("a")?.x).toBe(20); // stale echo of seq 2 ignored

    scene.applyPatch({ type: "patch", seq: 3, upserts: [shape("a", 20)], removes: [], engineMs: 0, remote: false });
    expect(scene.get("a")?.x).toBe(20);
  });

  it("accepts patches for shapes with no newer local edit", () => {
    const scene = new Scene();
    scene.applyPatch({ type: "patch", seq: 5, upserts: [shape("a", 7)], removes: [], order: ["a"], engineMs: 0, remote: false });
    expect(scene.get("a")?.x).toBe(7);
    expect(scene.ids()).toEqual(["a"]);
  });

  it("a remote order that predates a local create keeps the new shape visible", () => {
    const scene = new Scene();
    scene.applyPatch({ type: "patch", seq: 1, upserts: [shape("a")], removes: [], order: ["a"], engineMs: 0, remote: false });
    scene.addLocal([shape("mine")], 2); // worker hasn't processed seq 2 yet
    scene.applyPatch({ type: "patch", seq: 1, upserts: [shape("theirs")], removes: [], order: ["a", "theirs"], engineMs: 0, remote: true });
    expect(scene.ids()).toEqual(["a", "theirs", "mine"]);
  });

  it("preview shows a past version, keeps the live doc updating underneath, and returns to it", () => {
    const scene = new Scene();
    scene.applyPatch({ type: "patch", seq: 1, upserts: [shape("a", 1), shape("b", 2)], removes: [], order: ["a", "b"], engineMs: 0, remote: false });
    scene.dirty.clear();

    scene.setPreview([shape("a", 100)]); // the past: only "a", somewhere else
    expect(scene.previewing).toBe(true);
    expect(scene.ordered()).toEqual([shape("a", 100)]);
    expect([...scene.dirty].sort()).toEqual(["a", "b"]); // both change on screen
    expect(scene.animate).toBe(true);

    scene.dirty.clear();
    scene.applyPatch({ type: "patch", seq: 2, upserts: [shape("c", 3)], removes: [], order: ["a", "b", "c"], engineMs: 0, remote: true });
    expect(scene.dirty.size).toBe(0); // live change is invisible while previewing
    expect(scene.get("c")).toBeUndefined();

    scene.setPreview(null);
    expect(scene.ordered().map((s) => s.id)).toEqual(["a", "b", "c"]); // live, including what arrived meanwhile
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
