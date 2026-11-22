import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { CanvasDocument, type DocDelta, type ShapeProps } from "../src/index.js";

const rect = (x = 0, fill = 0x2f63ff): ShapeProps => ({ kind: "rect", x, y: 0, w: 10, h: 10, fill });

function sync(...docs: CanvasDocument[]): void {
  for (const from of docs) for (const to of docs) if (from !== to) to.merge(from.state);
}

describe("undo / redo on one replica", () => {
  it("undoes and redoes a move", () => {
    const doc = new CanvasDocument("a");
    doc.createShapes([{ id: "s", props: rect(0) }]);
    doc.updateShapes([{ id: "s", patch: { x: 100 } }]);
    doc.undo();
    expect(doc.shape("s")?.x).toBe(0);
    doc.redo();
    expect(doc.shape("s")?.x).toBe(100);
  });

  it("undoing a create removes the shape; redo brings it back", () => {
    const doc = new CanvasDocument("a");
    doc.createShapes([{ id: "s", props: rect(5) }]);
    doc.undo();
    expect(doc.shape("s")).toBeUndefined();
    doc.redo();
    expect(doc.shape("s")).toEqual({ id: "s", ...rect(5) });
  });

  it("undoing a delete restores the shape in its old stacking position", () => {
    const doc = new CanvasDocument("a");
    doc.createShapes(["a", "b", "c"].map((id) => ({ id, props: rect() })));
    doc.deleteShapes(["b"]);
    doc.undo();
    expect(doc.shapes().map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("undoes bring-to-front", () => {
    const doc = new CanvasDocument("a");
    doc.createShapes(["a", "b", "c"].map((id) => ({ id, props: rect() })));
    doc.bringToFront(["a"]);
    expect(doc.shapes().map((s) => s.id)).toEqual(["b", "c", "a"]);
    doc.undo();
    expect(doc.shapes().map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("every step of a drag (same group) undoes as one step, back to where it started", () => {
    const doc = new CanvasDocument("a");
    doc.createShapes([{ id: "s", props: rect(0) }]);
    for (let x = 1; x <= 30; x++) doc.updateShapes([{ id: "s", patch: { x } }], { group: 7 });
    doc.undo();
    expect(doc.shape("s")?.x).toBe(0);
    expect(doc.canUndo).toBe(true); // the create is still there to undo
  });

  it("a new edit after undo clears redo", () => {
    const doc = new CanvasDocument("a");
    doc.createShapes([{ id: "s", props: rect(0) }]);
    doc.updateShapes([{ id: "s", patch: { x: 1 } }]);
    doc.undo();
    doc.updateShapes([{ id: "s", patch: { x: 2 } }]);
    expect(doc.canRedo).toBe(false);
    expect(doc.redo()).toBeUndefined();
  });

  it("PROPERTY: undoing everything returns to the empty document; redoing everything returns to the end", () => {
    type Op = { kind: "create" } | { kind: "move"; pick: number; x: number } | { kind: "delete"; pick: number } | { kind: "front"; pick: number };
    const opArb: fc.Arbitrary<Op> = fc.oneof(
      fc.constant({ kind: "create" as const }),
      fc.record({ kind: fc.constant("move" as const), pick: fc.nat(), x: fc.integer({ min: -99, max: 99 }) }),
      fc.record({ kind: fc.constant("delete" as const), pick: fc.nat() }),
      fc.record({ kind: fc.constant("front" as const), pick: fc.nat() }),
    );
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
        let time = 1;
        const doc = new CanvasDocument("a", () => time++);
        let n = 0;
        let steps = 0;
        for (const op of ops) {
          const ids = doc.shapes().map((s) => s.id);
          const target = ids[("pick" in op ? op.pick : 0) % Math.max(1, ids.length)];
          let delta: DocDelta | undefined;
          if (op.kind === "create") delta = doc.createShapes([{ id: `s${n++}`, props: rect() }]);
          else if (target === undefined) continue;
          else if (op.kind === "move") delta = doc.updateShapes([{ id: target, patch: { x: op.x } }]);
          else if (op.kind === "delete") delta = doc.deleteShapes([target]);
          else delta = doc.bringToFront([target]);
          if (delta.tree.length > 0 || delta.props.length > 0) steps += 1;
        }
        const end = doc.shapes();
        for (let i = 0; i < steps; i++) expect(doc.undo()?.skipped).toBe(0);
        expect(doc.shapes()).toEqual([]);
        expect(doc.canUndo).toBe(false);
        for (let i = 0; i < steps; i++) doc.redo();
        expect(doc.shapes()).toEqual(end);
      }),
      { numRuns: 1_000 },
    );
  });
});

describe("selective undo with collaborators", () => {
  it("undo leaves another person's later change to a different property alone", () => {
    const alice = new CanvasDocument("alice");
    const bob = new CanvasDocument("bob");
    alice.createShapes([{ id: "s", props: rect(0) }]);
    sync(alice, bob);
    alice.updateShapes([{ id: "s", patch: { x: 100 } }]);
    sync(alice, bob);
    bob.updateShapes([{ id: "s", patch: { fill: 0xff0000 } }]);
    sync(alice, bob);

    const result = alice.undo(); // undo Alice's move
    sync(alice, bob);
    expect(result?.skipped).toBe(0);
    expect(alice.shape("s")).toMatchObject({ x: 0, fill: 0xff0000 }); // Bob's color survives
    expect(bob.shape("s")).toEqual(alice.shape("s"));
  });

  it("undo does NOT overwrite a property someone else changed after you", () => {
    const alice = new CanvasDocument("alice", () => 100);
    const bob = new CanvasDocument("bob", () => 200);
    alice.createShapes([{ id: "s", props: rect(0) }]);
    sync(alice, bob);
    alice.updateShapes([{ id: "s", patch: { x: 50 } }]);
    sync(alice, bob);
    bob.updateShapes([{ id: "s", patch: { x: 999 } }]); // Bob moves it after Alice
    sync(alice, bob);

    const result = alice.undo();
    expect(result?.skipped).toBe(1);
    expect(alice.shape("s")?.x).toBe(999); // Bob's position stands
  });

  it("undo does not resurrect a shape someone else deleted after your edit", () => {
    const alice = new CanvasDocument("alice");
    const bob = new CanvasDocument("bob");
    alice.createShapes([{ id: "s", props: rect() }]);
    alice.bringToFront(["s"]);
    sync(alice, bob);
    bob.deleteShapes(["s"]);
    sync(alice, bob);
    expect(alice.undo()?.skipped).toBe(1);
    expect(alice.shape("s")).toBeUndefined();
  });

  it("an undo syncs to everyone like a normal edit", () => {
    const alice = new CanvasDocument("alice");
    const bob = new CanvasDocument("bob");
    alice.createShapes([{ id: "s", props: rect(0) }]);
    alice.updateShapes([{ id: "s", patch: { x: 7 } }]);
    sync(alice, bob);
    const result = alice.undo();
    if (result) bob.merge(result.delta);
    expect(bob.shape("s")?.x).toBe(0);
  });

  it("PROPERTY: undoing ALL of Alice's edits never changes a property Bob currently owns", () => {
    type Step = { who: 0 | 1; kind: "create" | "move" | "color"; pick: number; value: number; sync: boolean };
    const stepArb: fc.Arbitrary<Step> = fc.record({
      who: fc.constantFrom(0 as const, 1 as const),
      kind: fc.constantFrom("create" as const, "move" as const, "color" as const),
      pick: fc.nat(),
      value: fc.integer({ min: 0, max: 0xffffff }),
      sync: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 40 }), (steps) => {
        let time = 1;
        const docs = [new CanvasDocument("alice", () => time++), new CanvasDocument("bob", () => time++)] as const;
        let n = 0;
        for (const step of steps) {
          const doc = docs[step.who];
          const ids = doc.shapes().map((s) => s.id);
          const target = ids[step.pick % Math.max(1, ids.length)];
          if (step.kind === "create") doc.createShapes([{ id: `s${n++}`, props: rect() }]);
          else if (target !== undefined && step.kind === "move") doc.updateShapes([{ id: target, patch: { x: step.value % 500 } }]);
          else if (target !== undefined) doc.updateShapes([{ id: target, patch: { fill: step.value } }]);
          if (step.sync) sync(...docs);
        }
        sync(...docs);
        const [alice] = docs;

        // Every property entry whose winning write is Bob's, before Alice undoes anything.
        const bobOwned = (): string[] =>
          alice.state.props.flatMap(([id, entries]) =>
            [...entries].filter(([, e]) => e.ts.replica === "bob").map(([key, e]) => `${id}.${key}=${JSON.stringify(e)}`),
          );
        const before = bobOwned();
        while (alice.undo());
        expect(bobOwned()).toEqual(before);
      }),
      { numRuns: 1_000 },
    );
  });

  it("remote edits never enter the local undo stack", () => {
    const alice = new CanvasDocument("alice");
    const bob = new CanvasDocument("bob");
    bob.createShapes([{ id: "s", props: rect() }]);
    sync(alice, bob);
    expect(alice.canUndo).toBe(false);
  });
});

describe("restoreTo (time travel)", () => {
  it("brings back deleted shapes, reverts props, removes new shapes and restores order — as one undo step", () => {
    const doc = new CanvasDocument("a");
    doc.createShapes(["a", "b", "c"].map((id, i) => ({ id, props: rect(i * 10) })));
    const version = doc.shapes();

    doc.deleteShapes(["b"]);
    doc.updateShapes([{ id: "a", patch: { x: 500, fill: 0xff0000 } }]);
    doc.createShapes([{ id: "new", props: rect() }]);
    doc.bringToFront(["a"]);
    const beforeRestore = doc.shapes();

    doc.restoreTo(version);
    expect(doc.shapes()).toEqual(version);

    doc.undo(); // the restore itself is undoable
    expect(doc.shapes()).toEqual(beforeRestore);
  });
});
