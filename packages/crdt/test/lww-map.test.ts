import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  HybridLogicalClock,
  LWWMap,
  compareTimestamps,
  mergeLWWMap,
  type LWWMapEntry,
  type LWWMapState,
  type Timestamp,
} from "../src/index.js";
import { timestampArb } from "./helpers/arbitraries.js";
import { describeSemilattice } from "./helpers/laws.js";
import { CONVERGENCE_RUNS, FUZZ_TIMEOUT_MS, simulate, stepsArb, type Scenario } from "./helpers/network.js";

/** As with the register: each (key, timestamp) identifies exactly one write. */
function entryFor(key: string, ts: Timestamp): LWWMapEntry<string> {
  return (ts.wall + ts.counter) % 3 === 0
    ? { ts, deleted: true }
    : { ts, deleted: false, value: `${key}@${ts.replica}:${ts.wall}:${ts.counter}` };
}

const stateArb: fc.Arbitrary<LWWMapState<string>> = fc
  .dictionary(fc.constantFrom("x", "y", "z"), timestampArb)
  .map((byKey) => new Map(Object.entries(byKey).map(([key, ts]) => [key, entryFor(key, ts)])));

function clockAt(replica: string, time: () => number): HybridLogicalClock {
  return new HybridLogicalClock(replica, time);
}

describe("LWWMap", () => {
  it("sets, overwrites and deletes keys", () => {
    let now = 1;
    const map = new LWWMap<number>(clockAt("a", () => now));
    map.set("x", 10);
    map.set("y", 20);
    now = 2;
    map.set("x", 11);
    map.delete("y");
    expect(map.get("x")).toBe(11);
    expect(map.has("y")).toBe(false);
    expect(map.entries()).toEqual([["x", 11]]);
  });

  it("keeps concurrent edits to DIFFERENT keys (no lost updates)", () => {
    const a = new LWWMap<string | number>(clockAt("a", () => 100));
    const b = new LWWMap<string | number>(clockAt("b", () => 100));
    const da = a.set("color", "red");
    const db = b.set("x", 42);
    a.merge(db);
    b.merge(da);
    expect(a.entries()).toEqual([["color", "red"], ["x", 42]]);
    expect(b.entries()).toEqual(a.entries());
  });

  it("a delete beats an older set that arrives late", () => {
    const a = new LWWMap<number>(clockAt("a", () => 100));
    const b = new LWWMap<number>(clockAt("b", () => 200));
    const oldSet = a.set("x", 1);
    b.merge(oldSet);
    const del = b.delete("x");
    const c = new LWWMap<number>(clockAt("c", () => 0));
    c.merge(del);
    c.merge(oldSet); // arrives after the delete
    expect(c.has("x")).toBe(false);
  });

  it("returns entries sorted by key", () => {
    const map = new LWWMap<number>(clockAt("a", () => 1));
    for (const key of ["c", "a", "b"]) map.set(key, 0);
    expect(map.entries().map(([key]) => key)).toEqual(["a", "b", "c"]);
  });
});

describeSemilattice("LWWMap", stateArb, mergeLWWMap);

type MapOp =
  | { readonly type: "set"; readonly key: string; readonly value: number }
  | { readonly type: "delete"; readonly key: string };

const keyArb = fc.constantFrom("a", "b", "c", "d");
const opArb: fc.Arbitrary<MapOp> = fc.oneof(
  fc.record({ type: fc.constant("set" as const), key: keyArb, value: fc.integer({ min: 0, max: 99 }) }),
  fc.record({ type: fc.constant("delete" as const), key: keyArb }),
);

const scenario: Scenario<LWWMap<number>, LWWMapState<number>, MapOp> = {
  replicaCount: 3,
  create: (id, now) => new LWWMap<number>(clockAt(id, now)),
  apply: (map, op) => (op.type === "set" ? map.set(op.key, op.value) : map.delete(op.key)),
  merge: (map, delta) => map.merge(delta),
};

describe("LWWMap convergence", () => {
  it(
    `every replica matches the per-key latest write across ${CONVERGENCE_RUNS} random histories`,
    () => {
      fc.assert(
        fc.property(stepsArb(opArb, scenario.replicaCount), fc.nat(), (steps, seed) => {
          const { replicas, sent } = simulate(scenario, steps, seed);

          // Oracle: for each key, the write with the greatest timestamp anywhere decides.
          const latest = new Map<string, LWWMapEntry<number>>();
          for (const { delta } of sent) {
            for (const [key, entry] of delta) {
              const best = latest.get(key);
              if (!best || compareTimestamps(entry.ts, best.ts) > 0) latest.set(key, entry);
            }
          }
          const expected = [...latest]
            .flatMap(([key, entry]) => (entry.deleted ? [] : [[key, entry.value] as const]))
            .sort(([a], [b]) => (a < b ? -1 : 1));

          for (const replica of replicas) {
            expect(replica.entries()).toEqual(expected);
            expect(replica.state).toEqual(replicas[0]?.state);
          }
        }),
        { numRuns: CONVERGENCE_RUNS },
      );
    },
    FUZZ_TIMEOUT_MS,
  );
});
