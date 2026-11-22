import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  HybridLogicalClock,
  LWWRegister,
  compareTimestamps,
  mergeLWWEntry,
  type LWWEntry,
} from "../src/index.js";
import { timestampArb } from "./helpers/arbitraries.js";
import { describeSemilattice } from "./helpers/laws.js";
import { CONVERGENCE_RUNS, FUZZ_TIMEOUT_MS, simulate, stepsArb, type Scenario } from "./helpers/network.js";

// In a real system a timestamp identifies exactly one write, so the value is a
// function of the timestamp. The arbitrary models that invariant.
const entryArb: fc.Arbitrary<LWWEntry<string>> = timestampArb.map((ts) => ({
  ts,
  value: `${ts.replica}:${ts.wall}:${ts.counter}`,
}));

describe("LWWRegister", () => {
  it("returns the latest local write", () => {
    let now = 100;
    const reg = new LWWRegister<string>(new HybridLogicalClock("a", () => now));
    reg.set("red");
    now = 200;
    reg.set("blue");
    expect(reg.value()).toBe("blue");
  });

  it("is empty until written", () => {
    expect(new LWWRegister(new HybridLogicalClock("a", () => 0)).value()).toBeUndefined();
  });

  it("an edit made AFTER seeing another edit wins, even with a clock far behind (causality)", () => {
    // b's clock is 10 seconds ahead of a's.
    const a = new LWWRegister<string>(new HybridLogicalClock("a", () => 1_000));
    const b = new LWWRegister<string>(new HybridLogicalClock("b", () => 11_000));

    a.merge(b.set("from-b"));
    const fromA = a.set("from-a"); // the user saw "from-b", then changed it
    b.merge(fromA);

    expect(a.value()).toBe("from-a");
    expect(b.value()).toBe("from-a");
  });

  it("resolves truly concurrent writes identically on every replica", () => {
    const a = new LWWRegister<string>(new HybridLogicalClock("a", () => 500));
    const b = new LWWRegister<string>(new HybridLogicalClock("b", () => 500));
    const da = a.set("A");
    const db = b.set("B");
    a.merge(db);
    b.merge(da);
    expect(a.value()).toBe(b.value());
    expect(a.value()).toBe("B"); // same wall + counter → higher replica id wins
  });
});

describeSemilattice("LWWRegister", entryArb, mergeLWWEntry);

type SetOp = { readonly value: number };

const scenario: Scenario<LWWRegister<number>, LWWEntry<number>, SetOp> = {
  replicaCount: 3,
  create: (id, now) => new LWWRegister<number>(new HybridLogicalClock(id, now)),
  apply: (reg, op) => reg.set(op.value),
  merge: (reg, delta) => reg.merge(delta),
};

describe("LWWRegister convergence", () => {
  it(
    `every replica holds the globally-latest write across ${CONVERGENCE_RUNS} random histories`,
    () => {
      fc.assert(
        fc.property(stepsArb(fc.record({ value: fc.integer({ min: 0, max: 99 }) }), scenario.replicaCount), fc.nat(), (steps, seed) => {
          const { replicas, sent } = simulate(scenario, steps, seed);
          const latest = sent.reduce<LWWEntry<number> | undefined>(
            (best, { delta }) => (best === undefined || compareTimestamps(delta.ts, best.ts) > 0 ? delta : best),
            undefined,
          );
          for (const replica of replicas) {
            expect(replica.state).toEqual(latest);
          }
        }),
        { numRuns: CONVERGENCE_RUNS },
      );
    },
    FUZZ_TIMEOUT_MS,
  );
});
