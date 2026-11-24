import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { VersionVector } from "@canvas/crdt";
import { CanvasDocument, formatPoints, parsePoints, type DocDelta, type ShapeProps } from "../src/index.js";

const rect = (x = 0, y = 0): ShapeProps => ({ kind: "rect", x, y, w: 10, h: 10, fill: 0x2f63ff });

function syncAll(...docs: CanvasDocument[]): void {
  for (const from of docs) for (const to of docs) if (from !== to) to.merge(from.state);
}

describe("CanvasDocument", () => {
  it("creates shapes and renders them back to front in creation order", () => {
    const doc = new CanvasDocument("a");
    doc.createShapes([
      { id: "s1", props: rect(0) },
      { id: "s2", props: rect(10) },
    ]);
    doc.createShapes([{ id: "s3", props: rect(20) }]);
    expect(doc.shapes().map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(doc.shape("s2")).toEqual({ id: "s2", ...rect(10) });
  });

  it("updates, deletes and brings shapes to front", () => {
    const doc = new CanvasDocument("a");
    doc.createShapes(["s1", "s2", "s3"].map((id) => ({ id, props: rect() })));
    doc.updateShapes([{ id: "s1", patch: { x: 50, fill: 0xff0000 } }]);
    expect(doc.shape("s1")).toMatchObject({ x: 50, fill: 0xff0000, y: 0 });
    doc.bringToFront(["s1"]);
    expect(doc.shapes().map((s) => s.id)).toEqual(["s2", "s3", "s1"]);
    doc.sendToBack(["s3"]);
    expect(doc.shapes().map((s) => s.id)).toEqual(["s3", "s2", "s1"]);
    doc.deleteShapes(["s2"]);
    expect(doc.shape("s2")).toBeUndefined();
    expect(doc.shapes().map((s) => s.id)).toEqual(["s3", "s1"]);
  });

  it("creates 5,000 shapes in one call with correct order", () => {
    const doc = new CanvasDocument("a");
    const ids = Array.from({ length: 5_000 }, (_, i) => `s${i}`);
    doc.createShapes(ids.map((id) => ({ id, props: rect() })));
    expect(doc.shapes().map((s) => s.id)).toEqual(ids);
  });

  it("rejects invalid properties and duplicate ids", () => {
    const doc = new CanvasDocument("a");
    expect(() => doc.createShapes([{ id: "s", props: { ...rect(), w: 0 } }])).toThrow(RangeError);
    expect(() => doc.createShapes([{ id: "s", props: { ...rect(), x: Number.NaN } }])).toThrow(RangeError);
    expect(() => doc.createShapes([{ id: "s", props: { ...rect(), fill: 0x1000000 } }])).toThrow(RangeError);
    doc.createShapes([{ id: "s", props: rect() }]);
    expect(() => doc.createShapes([{ id: "s", props: rect() }])).toThrow(RangeError);
  });

  it("concurrent move and recolor of the same shape both survive", () => {
    const alice = new CanvasDocument("alice");
    const bob = new CanvasDocument("bob");
    alice.createShapes([{ id: "s", props: rect() }]);
    syncAll(alice, bob);
    alice.updateShapes([{ id: "s", patch: { x: 100, y: 200 } }]);
    bob.updateShapes([{ id: "s", patch: { fill: 0x00ff00 } }]);
    syncAll(alice, bob);
    expect(alice.shape("s")).toMatchObject({ x: 100, y: 200, fill: 0x00ff00 });
    expect(bob.shape("s")).toEqual(alice.shape("s"));
  });

  it("a shape edited while concurrently deleted stays deleted", () => {
    const alice = new CanvasDocument("alice");
    const bob = new CanvasDocument("bob");
    alice.createShapes([{ id: "s", props: rect() }]);
    syncAll(alice, bob);
    alice.deleteShapes(["s"]);
    bob.updateShapes([{ id: "s", patch: { x: 5 } }]);
    syncAll(alice, bob);
    expect(alice.shape("s")).toBeUndefined();
    expect(bob.shape("s")).toBeUndefined();
  });

  it("labels: set, edit, sync, and validate", () => {
    const alice = new CanvasDocument("alice");
    const bob = new CanvasDocument("bob");
    alice.createShapes([{ id: "note", props: { ...rect(), label: "Ship beta" } }]);
    bob.merge(alice.state);
    expect(bob.shape("note")?.label).toBe("Ship beta");
    bob.updateShapes([{ id: "note", patch: { label: "Ship beta 🚀" } }]);
    alice.merge(bob.state);
    expect(alice.shape("note")?.label).toBe("Ship beta 🚀");
    expect(() => alice.updateShapes([{ id: "note", patch: { label: "x".repeat(501) } }])).toThrow(RangeError);
    expect(alice.shape("plain-missing")).toBeUndefined();
  });

  it("restoring a version without a label clears a label added since", () => {
    const doc = new CanvasDocument("a");
    doc.createShapes([{ id: "s", props: rect() }]);
    const version = doc.shapes();
    doc.updateShapes([{ id: "s", patch: { label: "added later" } }]);
    doc.restoreTo(version);
    expect(doc.shape("s")?.label).toBeUndefined();
  });

  it("board title syncs like a property but is never a shape", () => {
    const alice = new CanvasDocument("alice");
    const bob = new CanvasDocument("bob");
    bob.merge(alice.setTitle("  Q3   launch  plan "));
    expect(bob.title).toBe("Q3 launch plan");
    expect(bob.shapes()).toEqual([]);
    bob.merge(alice.setTitle("x".repeat(500)));
    expect(bob.title).toHaveLength(120);
  });

  it("merge reports which shapes changed", () => {
    const alice = new CanvasDocument("alice");
    const bob = new CanvasDocument("bob");
    const delta = alice.createShapes([{ id: "s1", props: rect() }, { id: "s2", props: rect() }]);
    expect([...bob.merge(delta)].sort()).toEqual(["s1", "s2"]);
  });
});

type DocOp =
  | { readonly type: "create"; readonly n: number }
  | { readonly type: "move"; readonly pick: number; readonly x: number }
  | { readonly type: "delete"; readonly pick: number }
  | { readonly type: "front"; readonly pick: number };

const opArb: fc.Arbitrary<DocOp> = fc.oneof(
  fc.record({ type: fc.constant("create" as const), n: fc.integer({ min: 1, max: 3 }) }),
  fc.record({ type: fc.constant("move" as const), pick: fc.nat(), x: fc.integer({ min: -100, max: 100 }) }),
  fc.record({ type: fc.constant("delete" as const), pick: fc.nat() }),
  fc.record({ type: fc.constant("front" as const), pick: fc.nat() }),
);

describe("CanvasDocument convergence", () => {
  it("3 replicas editing concurrently with partial syncs end up identical", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.nat({ max: 2 }), opArb, fc.boolean()), { maxLength: 40 }),
        (script) => {
          let time = 1_000;
          const docs = ["r0", "r1", "r2"].map((id) => new CanvasDocument(id, () => time));
          const sent: DocDelta[] = [];
          let created = 0;
          for (const [who, op, syncNow] of script) {
            const doc = docs[who];
            if (!doc) continue;
            time += 1;
            const ids = doc.shapes().map((s) => s.id);
            const target = ids[op.type === "create" ? 0 : op.pick % Math.max(1, ids.length)];
            if (op.type === "create") {
              sent.push(doc.createShapes(Array.from({ length: op.n }, () => ({ id: `s${created++}`, props: rect() }))));
            } else if (target !== undefined) {
              if (op.type === "move") sent.push(doc.updateShapes([{ id: target, patch: { x: op.x } }]));
              if (op.type === "delete") sent.push(doc.deleteShapes([target]));
              if (op.type === "front") sent.push(doc.bringToFront([target]));
            }
            if (syncNow) {
              const last = sent[sent.length - 1];
              if (last) for (const other of docs) other.merge(last);
            }
          }
          syncAll(...docs);
          const expected = docs[0]?.shapes();
          for (const doc of docs) expect(doc.shapes()).toEqual(expected);
        },
      ),
      { numRuns: 1_000 },
    );
  });
});

describe("rich shapes", () => {
  it("arrows, pen strokes and rotation round-trip and restore", () => {
    const doc = new CanvasDocument("a");
    doc.createShapes([
      { id: "a", props: rect() },
      { id: "arrow", props: { kind: "arrow", x: 0, y: 0, w: 50, h: 20, fill: 0, points: formatPoints([{ x: 0, y: 0 }, { x: 1, y: 1 }]), from: "a" } },
    ]);
    const version = doc.shapes();
    expect(doc.shape("arrow")).toMatchObject({ kind: "arrow", from: "a", points: "0,0 1,1" });
    expect(doc.shape("arrow")?.to).toBeUndefined();
    doc.updateShapes([{ id: "a", patch: { rotation: 0.5 } }, { id: "arrow", patch: { to: "a" } }]);
    expect(doc.shape("a")?.rotation).toBe(0.5);
    doc.restoreTo(version);
    expect(doc.shape("a")?.rotation).toBeUndefined();
    expect(doc.shape("arrow")?.to).toBeUndefined();
    expect(parsePoints("0,0 1,0.5 bad 2")).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0.5 }]);
    expect(() => doc.updateShapes([{ id: "a", patch: { rotation: Number.NaN } }])).toThrow(RangeError);
  });
});

describe("team rituals", () => {
  it("concurrent votes from different people all count, and toggle off", () => {
    const alice = new CanvasDocument("alice");
    const bob = new CanvasDocument("bob");
    alice.createShapes([{ id: "n", props: rect() }]);
    bob.merge(alice.state);
    const a = alice.vote("n", "alice", true);
    const b = bob.vote("n", "bob", true);
    alice.merge(b);
    bob.merge(a);
    expect(alice.shape("n")?.voters).toEqual(["alice", "bob"]);
    expect(bob.shape("n")).toEqual(alice.shape("n"));
    alice.merge(bob.vote("n", "bob", false));
    expect(alice.shape("n")?.voters).toEqual(["alice"]);
    expect(alice.vote("missing", "alice", true)).toEqual({ tree: [], props: [] });
  });

  it("comment replies from different people never overwrite each other", () => {
    const alice = new CanvasDocument("alice");
    const bob = new CanvasDocument("bob");
    alice.createShapes([{ id: "c", props: { ...rect(), kind: "comment", label: "Ship it?" } }]);
    bob.merge(alice.state);
    // Both reply at the same moment, offline from each other.
    const a = alice.reply("c", "001-alice", '{"t":"yes"}');
    const b = bob.reply("c", "001-bob", '{"t":"not yet"}');
    alice.merge(b);
    bob.merge(a);
    expect(alice.shape("c")?.replies?.map((r) => r.key)).toEqual(["001-alice", "001-bob"]);
    expect(bob.shape("c")).toEqual(alice.shape("c"));
    // Deleting is writing "", which hides the reply everywhere.
    bob.merge(alice.reply("c", "001-alice", ""));
    expect(bob.shape("c")?.replies?.map((r) => r.key)).toEqual(["001-bob"]);
    expect(() => alice.reply("c", "bad key!", "x")).toThrow(RangeError);
    expect(() => alice.reply("c", "k", "x".repeat(5000))).toThrow(RangeError);
    expect(alice.reply("missing", "k", "x")).toEqual({ tree: [], props: [] });
  });

  it("the shared timer syncs through board meta", () => {
    const alice = new CanvasDocument("alice");
    const bob = new CanvasDocument("bob");
    bob.merge(alice.setMeta({ timerEnd: 1_000_000, timerTotal: 300_000 }));
    bob.merge(alice.setTitle("Retro"));
    expect(bob.meta).toEqual({ title: "Retro", timerEnd: 1_000_000, timerTotal: 300_000, timerPaused: undefined });
    expect(() => alice.setMeta({ timerEnd: -1 })).toThrow(RangeError);
  });
});

describe("collaborative FugueText labels & causal stability GC", () => {
  it("simultaneous multi-user typing inside the same note never overwrites each other", () => {
    const alice = new CanvasDocument("alice");
    const bob = new CanvasDocument("bob");
    alice.createShapes([{ id: "note1", props: { ...rect(), label: "Hello" } }]);
    bob.merge(alice.state);

    // Alice types " world" at the end while Bob concurrently types "!" at the end.
    const dAlice = alice.editLabel("note1", { index: 5, deleteCount: 0, insert: " world" });
    const dBob = bob.editLabel("note1", { index: 5, deleteCount: 0, insert: "!" });

    alice.merge(dBob);
    bob.merge(dAlice);

    expect(alice.shape("note1")?.label).toBe(bob.shape("note1")?.label);
    const merged = alice.shape("note1")?.label ?? "";
    expect(merged).toContain("Hello");
    expect(merged).toContain(" world");
    expect(merged).toContain("!");
  });

  it("garbage-collects causally stable deleted shapes and tombstones", () => {
    let clock = 10;
    const alice = new CanvasDocument("alice", () => clock++);
    const bob = new CanvasDocument("bob", () => clock++);

    alice.createShapes([{ id: "s1", props: rect() }, { id: "s2", props: rect() }]);
    bob.merge(alice.state);

    alice.deleteShapes(["s1"]);
    bob.merge(alice.state);

    const horizon = VersionVector.stableHorizon([alice.versionVector, bob.versionVector]);
    const stats = alice.gc(horizon);
    expect(stats.shapesPurged).toBe(1);
    expect(alice.shape("s1")).toBeUndefined();
    expect(alice.shape("s2")).toBeDefined();
  });
});
