import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { HybridLogicalClock, LWWMap, MoveTree, ROOT, VersionVector } from "../src/index.js";

describe("VersionVector", () => {
  it("tracks per-replica max timestamps and computes causal stability horizon", () => {
    const alice = new VersionVector();
    const bob = new VersionVector();

    alice.observe({ replica: "a", wall: 10, counter: 0 });
    alice.observe({ replica: "b", wall: 5, counter: 2 });

    bob.observe({ replica: "a", wall: 8, counter: 1 });
    bob.observe({ replica: "b", wall: 6, counter: 0 });
    bob.observe({ replica: "c", wall: 100, counter: 0 }); // not seen by alice

    const horizon = VersionVector.stableHorizon([alice, bob]);
    expect(horizon.hasSeen({ replica: "a", wall: 8, counter: 1 })).toBe(true);
    expect(horizon.hasSeen({ replica: "a", wall: 9, counter: 0 })).toBe(false);
    expect(horizon.hasSeen({ replica: "b", wall: 5, counter: 2 })).toBe(true);
    expect(horizon.hasSeen({ replica: "b", wall: 6, counter: 0 })).toBe(false);
    expect(horizon.hasSeen({ replica: "c", wall: 1, counter: 0 })).toBe(false);
  });
});

describe("Tombstone & MoveTree GC", () => {
  it("collects causally stable LWWMap tombstones without losing live entries or unstable tombstones", () => {
    let time = 10;
    const mapA = new LWWMap<string>(new HybridLogicalClock("a", () => time++));
    const mapB = new LWWMap<string>(new HybridLogicalClock("b", () => time++));

    const d1 = mapA.set("x", "hello");
    const d2 = mapA.set("y", "world");
    const d3 = mapA.delete("x"); // deleted at t=12

    mapB.merge(d1);
    mapB.merge(d2);
    mapB.merge(d3);

    const d4 = mapB.delete("y"); // deleted at t=13 by B (A hasn't seen it yet)

    const vvA = new VersionVector();
    for (const e of mapA.state.values()) vvA.observe(e.ts);
    const vvB = new VersionVector();
    for (const e of mapB.state.values()) vvB.observe(e.ts);

    const horizon = VersionVector.stableHorizon([vvA, vvB]);
    expect(mapB.gc(horizon)).toBe(1); // "x" tombstone collected
    expect(mapB.state.has("x")).toBe(false);
    expect(mapB.state.has("y")).toBe(true); // "y" tombstone kept because A hasn't seen d4

    mapA.merge(d4);
    for (const e of mapA.state.values()) vvA.observe(e.ts);
    const horizon2 = VersionVector.stableHorizon([vvA, vvB]);
    expect(mapB.gc(horizon2)).toBe(1); // now "y" tombstone is also collected
    expect(mapB.state.size).toBe(0);
  });

  it("purges causally stable deleted MoveTree nodes and compacts superseded ops", () => {
    let time = 10;
    const treeA = new MoveTree(new HybridLogicalClock("a", () => time++));
    const treeB = new MoveTree(new HybridLogicalClock("b", () => time++));

    treeA.move("n1", ROOT, "a0");
    treeA.move("n1", ROOT, "a1");
    treeA.delete("n1");
    treeA.move("n2", ROOT, "a2");

    treeB.merge(treeA.ops);

    const vvA = new VersionVector();
    for (const op of treeA.ops) vvA.observe(op.ts);
    const vvB = new VersionVector();
    for (const op of treeB.ops) vvB.observe(op.ts);

    const horizon = VersionVector.stableHorizon([vvA, vvB]);
    const collected = treeA.gc(horizon);
    treeB.gc(horizon);

    expect(collected).toBeGreaterThan(0);
    expect(treeA.get("n1")).toBeUndefined();
    expect(treeA.nodes()).toEqual(treeB.nodes());
    expect(treeA.children(ROOT)).toEqual(["n2"]);
  });

  it("PROPERTY: MoveTree and LWWMap remain convergent after causal stability GC", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom("a", "b"), { minLength: 5, maxLength: 30 }), (actors) => {
        let clock = 1;
        const tA = new MoveTree(new HybridLogicalClock("a", () => clock++));
        const tB = new MoveTree(new HybridLogicalClock("b", () => clock++));

        actors.forEach((actor, idx) => {
          const target = actor === "a" ? tA : tB;
          const id = `n${idx % 4}`;
          if (idx % 3 === 2 && target.isAttached(id)) target.delete(id);
          else target.move(id, ROOT, "a0");
        });

        tA.merge(tB.ops);
        tB.merge(tA.ops);

        const vvA = new VersionVector();
        for (const op of tA.ops) vvA.observe(op.ts);
        const vvB = new VersionVector();
        for (const op of tB.ops) vvB.observe(op.ts);

        const horizon = VersionVector.stableHorizon([vvA, vvB]);
        tA.gc(horizon);
        tB.gc(horizon);

        expect(tA.nodes()).toEqual(tB.nodes());
      }),
      { numRuns: 200 },
    );
  });
});
