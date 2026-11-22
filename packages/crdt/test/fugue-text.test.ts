import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { FugueText, type CharId, type TextDelta, type TextInsert } from "../src/index.js";
import { CONVERGENCE_RUNS, FUZZ_TIMEOUT_MS, at, simulate, stepsArb, type Scenario } from "./helpers/network.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function syncAll(...docs: FugueText[]): void {
  for (const from of docs) for (const to of docs) if (from !== to) to.merge(from.state);
}

/** Type a string one keystroke at a time, the way a user does. */
function typeForward(doc: FugueText, index: number, text: string): void {
  Array.from(text).forEach((char, i) => doc.insert(index + i, char));
}

/** Type a string backwards (cursor stays put; each key goes before the previous one). */
function typeBackward(doc: FugueText, index: number, text: string): void {
  for (const char of Array.from(text).reverse()) doc.insert(index, char);
}

/**
 * Independent reference: rebuild the whole Fugue tree in one batch from every insert
 * ever sent, sort siblings by id, walk it recursively, drop deleted ids.
 * The incremental engine (pending buffers, sorted insertion, cached walk) must match.
 */
function referenceText(inserts: readonly TextInsert[], deletes: readonly CharId[]): string {
  const key = (id: CharId): string => `${id.replica}:${id.counter}`;
  const byId = new Map(inserts.map((op) => [key(op.id), op]));
  const children = new Map<string, { left: TextInsert[]; right: TextInsert[] }>();
  for (const op of byId.values()) {
    const parent = op.parent ? key(op.parent) : "";
    const entry = children.get(parent) ?? { left: [], right: [] };
    entry[op.side].push(op);
    children.set(parent, entry);
  }
  const byIdOrder = (a: TextInsert, b: TextInsert): number =>
    a.id.replica !== b.id.replica ? (a.id.replica < b.id.replica ? -1 : 1) : a.id.counter - b.id.counter;
  for (const entry of children.values()) {
    entry.left.sort(byIdOrder);
    entry.right.sort(byIdOrder);
  }
  const deleted = new Set(deletes.map(key));
  const walk = (nodeKey: string, self: string): string => {
    const entry = children.get(nodeKey);
    const side = (ops: TextInsert[] | undefined): string =>
      (ops ?? []).map((op) => walk(key(op.id), deleted.has(key(op.id)) ? "" : op.value)).join("");
    return side(entry?.left) + self + side(entry?.right);
  };
  return walk("", "");
}

// ---------------------------------------------------------------------------
// Named scenarios
// ---------------------------------------------------------------------------

describe("FugueText", () => {
  it("inserts and deletes like a normal string", () => {
    const doc = new FugueText("a");
    doc.insert(0, "hello");
    doc.insert(5, " world");
    doc.insert(5, ",");
    expect(doc.toString()).toBe("hello, world");
    doc.delete(0, 7);
    expect(doc.toString()).toBe("world");
    expect(doc.length).toBe(5);
  });

  it("treats emoji as single characters", () => {
    const doc = new FugueText("a");
    doc.insert(0, "a👍b");
    expect(doc.length).toBe(3);
    doc.delete(1);
    expect(doc.toString()).toBe("ab");
  });

  it("rejects out-of-range edits", () => {
    const doc = new FugueText("a");
    doc.insert(0, "abc");
    expect(() => doc.insert(4, "x")).toThrow(RangeError);
    expect(() => doc.insert(-1, "x")).toThrow(RangeError);
    expect(() => doc.delete(2, 2)).toThrow(RangeError);
  });

  it("concurrent forward typing at the same spot does not interleave", () => {
    const alice = new FugueText("alice");
    const bob = new FugueText("bob");
    typeForward(alice, 0, "hello");
    typeForward(bob, 0, "world");
    syncAll(alice, bob);
    expect(alice.toString()).toBe(bob.toString());
    expect(["helloworld", "worldhello"]).toContain(alice.toString());
  });

  it("concurrent BACKWARD typing at the same spot does not interleave (RGA fails this)", () => {
    const alice = new FugueText("alice");
    const bob = new FugueText("bob");
    typeBackward(alice, 0, "hello");
    typeBackward(bob, 0, "world");
    syncAll(alice, bob);
    expect(["helloworld", "worldhello"]).toContain(alice.toString());
    expect(bob.toString()).toBe(alice.toString());
  });

  it("concurrent edits in the middle of shared text keep both edits in place", () => {
    const alice = new FugueText("alice");
    const bob = new FugueText("bob");
    alice.insert(0, "The cat sat");
    syncAll(alice, bob);
    alice.insert(4, "fat ");
    bob.insert(11, " down");
    syncAll(alice, bob);
    expect(alice.toString()).toBe("The fat cat sat down");
    expect(bob.toString()).toBe(alice.toString());
  });

  it("concurrent delete and insert next to it both survive", () => {
    const alice = new FugueText("alice");
    const bob = new FugueText("bob");
    alice.insert(0, "abc");
    syncAll(alice, bob);
    alice.delete(1); // remove "b"
    bob.insert(2, "X"); // after "b"
    syncAll(alice, bob);
    expect(alice.toString()).toBe("aXc");
    expect(bob.toString()).toBe("aXc");
  });

  it("an insert that arrives before its parent waits, then appears", () => {
    const writer = new FugueText("w");
    const first = writer.insert(0, "a");
    const second = writer.insert(1, "b");
    const reader = new FugueText("r");
    reader.merge(second); // parent "a" unknown yet
    expect(reader.toString()).toBe("");
    reader.merge(first);
    expect(reader.toString()).toBe("ab");
  });

  it("a delete that overtakes its insert still applies", () => {
    const writer = new FugueText("w");
    const ins = writer.insert(0, "x");
    const del = writer.delete(0);
    const reader = new FugueText("r");
    reader.merge(del);
    reader.merge(ins);
    expect(reader.toString()).toBe("");
  });

  it("ignores duplicate deliveries", () => {
    const writer = new FugueText("w");
    writer.insert(0, "abc");
    const reader = new FugueText("r");
    reader.merge(writer.state);
    reader.merge(writer.state);
    expect(reader.toString()).toBe("abc");
    expect(reader.state.inserts).toHaveLength(3);
  });

  it("keeps ids unique after reloading its own state", () => {
    const original = new FugueText("a");
    original.insert(0, "ab");
    const reloaded = new FugueText("a", original.state);
    reloaded.insert(2, "c");
    const ids = reloaded.state.inserts.map(({ id }) => `${id.replica}:${id.counter}`);
    expect(new Set(ids).size).toBe(ids.length);
    expect(reloaded.toString()).toBe("abc");
  });
});

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

type EditOp =
  | { readonly type: "insert"; readonly index: number; readonly text: string }
  | { readonly type: "delete"; readonly index: number; readonly count: number };

const editArb: fc.Arbitrary<EditOp> = fc.oneof(
  {
    arbitrary: fc.record({
      type: fc.constant("insert" as const),
      index: fc.nat(),
      text: fc.string({ unit: fc.constantFrom(..."abcdefxyz"), minLength: 1, maxLength: 3 }),
    }),
    weight: 3,
  },
  {
    arbitrary: fc.record({ type: fc.constant("delete" as const), index: fc.nat(), count: fc.integer({ min: 1, max: 3 }) }),
    weight: 1,
  },
);

/** Apply an edit with indexes clamped to the current length. Returns null if it can't apply. */
function applyEdit(doc: FugueText, op: EditOp): TextDelta | null {
  if (op.type === "insert") return doc.insert(op.index % (doc.length + 1), op.text);
  if (doc.length === 0) return null;
  const index = op.index % doc.length;
  return doc.delete(index, Math.min(op.count, doc.length - index));
}

describe("FugueText properties", () => {
  it("on one replica, behaves exactly like a JavaScript string (model-based)", () => {
    fc.assert(
      fc.property(fc.array(editArb, { maxLength: 60 }), (ops) => {
        const doc = new FugueText("a");
        let model = "";
        for (const op of ops) {
          if (op.type === "insert") {
            const index = op.index % (model.length + 1);
            doc.insert(index, op.text);
            model = model.slice(0, index) + op.text + model.slice(index);
          } else if (model.length > 0) {
            const index = op.index % model.length;
            const count = Math.min(op.count, model.length - index);
            doc.delete(index, count);
            model = model.slice(0, index) + model.slice(index + count);
          }
          expect(doc.toString()).toBe(model);
        }
      }),
      { numRuns: 2_000 },
    );
  });

  it("three people typing at the same spot never interleave (forward or backward)", () => {
    const alphabets = ["abcdefgh", "ABCDEFGH", "12345678"] as const;
    const runArb = fc.record({ backward: fc.boolean(), length: fc.integer({ min: 1, max: 8 }) });
    fc.assert(
      fc.property(fc.nat({ max: 8 }), fc.nat(), fc.tuple(runArb, runArb, runArb), (baseLength, pick, runs) => {
        const base = new FugueText("base");
        base.insert(0, "-".repeat(baseLength));
        const docs = ["r0", "r1", "r2"].map((id) => new FugueText(id, base.state));
        const position = pick % (baseLength + 1);

        const words = runs.map((run, i) => at(alphabets, i).slice(0, run.length));
        docs.forEach((doc, i) => {
          const word = at(words, i);
          if (at(runs, i).backward) typeBackward(doc, position, word);
          else typeForward(doc, position, word);
        });
        syncAll(...docs);

        const result = at(docs, 0).toString();
        for (const doc of docs) expect(doc.toString()).toBe(result);
        for (const word of words) expect(result).toContain(word); // each word stays in one piece
        expect(result.replaceAll(/[^-]/g, "")).toBe("-".repeat(baseLength)); // base untouched
      }),
      { numRuns: 5_000 },
    );
  });
});

// ---------------------------------------------------------------------------
// Convergence gate
// ---------------------------------------------------------------------------

const scenario: Scenario<FugueText, TextDelta, EditOp> = {
  replicaCount: 3,
  create: (id) => new FugueText(id),
  apply: (doc, op) => applyEdit(doc, op) ?? { inserts: [], deletes: [] },
  merge: (doc, delta) => doc.merge(delta),
};

describe("FugueText convergence", () => {
  it(
    `every replica matches a from-scratch rebuild across ${CONVERGENCE_RUNS} random histories`,
    () => {
      fc.assert(
        fc.property(stepsArb(editArb, scenario.replicaCount), fc.nat(), (steps, seed) => {
          const { replicas, sent } = simulate(scenario, steps, seed);
          const expected = referenceText(
            sent.flatMap(({ delta }) => delta.inserts),
            sent.flatMap(({ delta }) => delta.deletes),
          );
          for (const replica of replicas) expect(replica.toString()).toBe(expected);
        }),
        { numRuns: CONVERGENCE_RUNS },
      );
    },
    FUZZ_TIMEOUT_MS,
  );
});
