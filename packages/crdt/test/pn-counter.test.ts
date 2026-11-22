import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { PNCounter, mergePNCounter, type PNCounterState } from "../src/index.js";
import { describeSemilattice } from "./helpers/laws.js";
import { CONVERGENCE_RUNS, FUZZ_TIMEOUT_MS, simulate, stepsArb, type Scenario } from "./helpers/network.js";

const slotsArb = fc
  .dictionary(fc.constantFrom("a", "b", "c"), fc.nat({ max: 50 }))
  .map((slots) => new Map(Object.entries(slots)));
const stateArb: fc.Arbitrary<PNCounterState> = fc.record({ p: slotsArb, n: slotsArb });

describe("PNCounter", () => {
  it("increments and decrements", () => {
    const counter = new PNCounter("a");
    counter.increment();
    counter.increment(5);
    counter.decrement(2);
    expect(counter.value()).toBe(4);
  });

  it("combines concurrent edits from different replicas", () => {
    const a = new PNCounter("a");
    const b = new PNCounter("b");
    const da = a.increment(3);
    const db = b.decrement(1);
    a.merge(db);
    b.merge(da);
    expect(a.value()).toBe(2);
    expect(b.value()).toBe(2);
  });

  it("ignores duplicate deliveries", () => {
    const a = new PNCounter("a");
    const b = new PNCounter("b");
    const delta = a.increment(3);
    b.merge(delta);
    b.merge(delta);
    expect(b.value()).toBe(3);
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects invalid amount %s", (amount) => {
    expect(() => new PNCounter("a").increment(amount)).toThrow(RangeError);
  });
});

describeSemilattice("PNCounter", stateArb, mergePNCounter);

type CounterOp = { readonly type: "inc" | "dec"; readonly by: number };

const scenario: Scenario<PNCounter, PNCounterState, CounterOp> = {
  replicaCount: 3,
  create: (id) => new PNCounter(id),
  apply: (counter, op) => (op.type === "inc" ? counter.increment(op.by) : counter.decrement(op.by)),
  merge: (counter, delta) => counter.merge(delta),
};

describe("PNCounter convergence", () => {
  it(
    `converges to the true total across ${CONVERGENCE_RUNS} random histories`,
    () => {
      const opArb = fc.record({ type: fc.constantFrom("inc" as const, "dec" as const), by: fc.integer({ min: 1, max: 5 }) });
      fc.assert(
        fc.property(stepsArb(opArb, scenario.replicaCount), fc.nat(), (steps, seed) => {
          const { replicas } = simulate(scenario, steps, seed);
          const expected = steps.reduce(
            (total, step) => (step.kind !== "op" ? total : total + (step.op.type === "inc" ? step.op.by : -step.op.by)),
            0,
          );
          for (const replica of replicas) {
            expect(replica.value()).toBe(expected);
            expect(replica.state).toEqual(replicas[0]?.state);
          }
        }),
        { numRuns: CONVERGENCE_RUNS },
      );
    },
    FUZZ_TIMEOUT_MS,
  );
});
