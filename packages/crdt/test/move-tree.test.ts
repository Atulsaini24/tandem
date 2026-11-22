import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  HybridLogicalClock,
  MoveTree,
  ROOT,
  TRASH,
  TreeCycleError,
  compareTimestamps,
  type MoveOp,
  type NodeId,
  type TreeDelta,
  type TreeNode,
} from "../src/index.js";
import { CONVERGENCE_RUNS, FUZZ_TIMEOUT_MS, simulate, stepsArb, type Scenario } from "./helpers/network.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tree(replica: string, now: () => number = () => 100): MoveTree {
  return new MoveTree(new HybridLogicalClock(replica, now));
}

/** Full anti-entropy between every pair of replicas. */
function syncAll(...trees: MoveTree[]): void {
  for (const from of trees) for (const to of trees) if (from !== to) to.merge(from.ops);
}

/**
 * Independent reference semantics: sort ALL ops by timestamp and replay them on an
 * empty tree, skipping any op that would create a cycle. The undo/redo engine must
 * always produce exactly this, no matter the order ops arrived in.
 */
function referenceTree(ops: readonly MoveOp[]): Array<readonly [NodeId, TreeNode]> {
  const nodes = new Map<NodeId, TreeNode>();
  const isAncestor = (ancestor: NodeId, node: NodeId): boolean => {
    const visited = new Set<NodeId>();
    for (let current: NodeId | undefined = node; current !== undefined; current = nodes.get(current)?.parent) {
      if (current === ancestor) return true;
      if (visited.has(current)) throw new Error("reference tree has a cycle");
      visited.add(current);
    }
    return false;
  };
  for (const op of [...ops].sort((a, b) => compareTimestamps(a.ts, b.ts))) {
    if (op.child === ROOT || op.child === TRASH || isAncestor(op.child, op.parent)) continue;
    nodes.set(op.child, { parent: op.parent, position: op.position });
  }
  return [...nodes].sort(([a], [b]) => (a < b ? -1 : 1));
}

/** Independent acyclicity check: walking up from any node must terminate. */
function expectAcyclic(t: MoveTree): void {
  for (const [id] of t.nodes()) {
    const visited = new Set<NodeId>();
    for (let current: NodeId | undefined = id; current !== undefined; current = t.get(current)?.parent) {
      expect(visited.has(current)).toBe(false);
      visited.add(current);
    }
  }
}

// ---------------------------------------------------------------------------
// Named scenarios
// ---------------------------------------------------------------------------

describe("MoveTree", () => {
  it("orders children by position, ties broken by id", () => {
    const t = tree("a");
    t.move("c", ROOT, "V");
    t.move("b", ROOT, "k");
    t.move("a", ROOT, "V");
    expect(t.children(ROOT)).toEqual(["a", "c", "b"]);
  });

  it("moving a group carries its whole subtree", () => {
    const t = tree("a");
    t.move("group", ROOT, "V");
    t.move("shape", "group", "V");
    t.move("frame", ROOT, "k");
    t.move("group", "frame", "V");
    expect(t.get("shape")?.parent).toBe("group");
    expect(t.get("group")?.parent).toBe("frame");
    expect(t.isAttached("shape")).toBe(true);
  });

  it("rejects local moves that would create a cycle", () => {
    const t = tree("a");
    t.move("group", ROOT, "V");
    t.move("child", "group", "V");
    expect(() => t.move("group", "child", "V")).toThrow(TreeCycleError);
    expect(() => t.move("group", "group", "V")).toThrow(TreeCycleError);
    expect(() => t.move(ROOT, "group", "V")).toThrow(RangeError);
  });

  it("concurrent A→B and B→A: no cycle, every replica agrees, the earlier move wins", () => {
    const alice = tree("alice");
    const bob = tree("bob");
    alice.move("A", ROOT, "V");
    alice.move("B", ROOT, "k");
    syncAll(alice, bob);

    // Both offline, same wall time. Same wall + counter → "bob" > "alice", so Alice's op is older.
    alice.move("A", "B", "V");
    bob.move("B", "A", "V");
    syncAll(alice, bob);

    for (const t of [alice, bob]) {
      expectAcyclic(t);
      expect(t.get("A")?.parent).toBe("B"); // Alice's move applied
      expect(t.get("B")?.parent).toBe(ROOT); // Bob's move skipped: it would form a cycle
    }
    expect(alice.nodes()).toEqual(bob.nodes());
  });

  it("the same node moved concurrently to two parents ends up in exactly one", () => {
    const alice = tree("alice", () => 100);
    const bob = tree("bob", () => 200);
    alice.move("shape", ROOT, "V");
    alice.move("left", ROOT, "a");
    alice.move("right", ROOT, "z");
    syncAll(alice, bob);

    alice.move("shape", "left", "V");
    bob.move("shape", "right", "V"); // later timestamp
    syncAll(alice, bob);

    expect(alice.get("shape")?.parent).toBe("right");
    expect(bob.get("shape")?.parent).toBe("right");
    expect(alice.children("left")).toEqual([]);
  });

  it("a late, older op is slotted into the past via undo → apply → redo", () => {
    const writer = tree("w");
    const early = writer.move("x", ROOT, "V");
    writer.move("g", ROOT, "k");
    const late = writer.move("x", "g", "V");

    const inOrder = tree("r1");
    inOrder.merge([...early, ...late]);
    const reversed = tree("r2");
    reversed.merge(late); // newer op first: "x" placed under "g" (an orphan for now)
    reversed.merge(early); // older op arrives: must be undone/redone underneath

    expect(reversed.get("x")).toEqual(inOrder.get("x"));
    expect(reversed.get("x")?.parent).toBe("g");
  });

  it("delete moves the subtree to TRASH; moving it back restores it", () => {
    const t = tree("a");
    t.move("group", ROOT, "V");
    t.move("shape", "group", "V");
    t.delete("group");
    expect(t.isAttached("shape")).toBe(false);
    expect(t.children(ROOT)).toEqual([]);
    t.move("group", ROOT, "V");
    expect(t.isAttached("shape")).toBe(true);
  });

  it("ignores duplicate deliveries", () => {
    const a = tree("a");
    const b = tree("b");
    a.move("x", ROOT, "V");
    b.merge(a.ops);
    b.merge(a.ops);
    expect(b.ops).toHaveLength(1);
    expect(b.nodes()).toEqual(a.nodes());
  });
});

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

const nodeArb = fc.constantFrom("n0", "n1", "n2", "n3", "n4");
const parentArb = fc.constantFrom(ROOT, TRASH, "n0", "n1", "n2", "n3", "n4");
const positionArb = fc.constantFrom("V", "a", "k");

/** Ops as a remote replica might send them: unique timestamps, no local validation. */
const remoteOpsArb: fc.Arbitrary<MoveOp[]> = fc.uniqueArray(
  fc.record({
    ts: fc.record({ wall: fc.integer({ min: 0, max: 15 }), counter: fc.nat({ max: 2 }), replica: fc.constantFrom("a", "b", "c") }),
    child: nodeArb,
    parent: parentArb,
    position: positionArb,
  }),
  { selector: (op) => `${op.ts.wall}:${op.ts.counter}:${op.ts.replica}`, maxLength: 40 },
);

describe("MoveTree properties", () => {
  it("any delivery order (in batches, one by one, duplicated) yields the reference tree", () => {
    fc.assert(
      fc.property(
        remoteOpsArb.chain((ops) => fc.tuple(fc.constant(ops), fc.shuffledSubarray(ops, { minLength: ops.length }))),
        ([ops, permuted]) => {
          const batch = tree("x");
          batch.merge(ops);
          const oneByOne = tree("y");
          for (const op of permuted) oneByOne.merge([op]);
          oneByOne.merge(ops); // duplicates

          const expected = referenceTree(ops);
          expect(batch.nodes()).toEqual(expected);
          expect(oneByOne.nodes()).toEqual(expected);
          expectAcyclic(oneByOne);
        },
      ),
      { numRuns: 5_000 },
    );
  });
});

// ---------------------------------------------------------------------------
// Convergence gate
// ---------------------------------------------------------------------------

type TreeOp = { readonly child: NodeId; readonly parent: NodeId; readonly position: string };

const scenario: Scenario<MoveTree, TreeDelta, TreeOp> = {
  replicaCount: 3,
  create: (id, now) => new MoveTree(new HybridLogicalClock(id, now)),
  apply: (t, op) => {
    try {
      return t.move(op.child, op.parent, op.position);
    } catch (error) {
      if (error instanceof TreeCycleError) return []; // the UI would have blocked this drop
      throw error;
    }
  },
  merge: (t, delta) => t.merge(delta),
};

describe("MoveTree convergence", () => {
  it(
    `every replica builds the reference tree, acyclic, across ${CONVERGENCE_RUNS} random histories`,
    () => {
      const opArb = fc.record({ child: nodeArb, parent: parentArb, position: positionArb });
      fc.assert(
        fc.property(stepsArb(opArb, scenario.replicaCount), fc.nat(), (steps, seed) => {
          const { replicas, sent } = simulate(scenario, steps, seed);
          const expected = referenceTree(sent.flatMap(({ delta }) => delta));
          for (const replica of replicas) {
            expect(replica.nodes()).toEqual(expected);
            expectAcyclic(replica);
          }
        }),
        { numRuns: CONVERGENCE_RUNS },
      );
    },
    FUZZ_TIMEOUT_MS,
  );
});
