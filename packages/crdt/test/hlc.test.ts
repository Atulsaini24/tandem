import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { HybridLogicalClock, compareTimestamps, type Timestamp } from "../src/index.js";
import { timestampArb } from "./helpers/arbitraries.js";

/** A physical clock that replays a scripted list of readings. */
function scriptedClock(readings: readonly number[]): { read: () => number; advance: () => void } {
  let i = 0;
  return { read: () => readings[i] ?? 0, advance: () => void i++ };
}

describe("HybridLogicalClock", () => {
  it("is strictly monotonic even when the physical clock jumps backwards", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 1_000 }), { minLength: 1, maxLength: 200 }), (readings) => {
        const physical = scriptedClock(readings);
        const clock = new HybridLogicalClock("a", physical.read);
        let previous: Timestamp | undefined;
        for (let i = 0; i < readings.length; i++) {
          const ts = clock.now();
          if (previous) expect(compareTimestamps(previous, ts)).toBe(-1);
          previous = ts;
          physical.advance();
        }
      }),
      { numRuns: 1_000 },
    );
  });

  it("never lets wall time fall behind physical time", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 1_000 }), { minLength: 1, maxLength: 100 }), (readings) => {
        const physical = scriptedClock(readings);
        const clock = new HybridLogicalClock("a", physical.read);
        for (const reading of readings) {
          expect(clock.now().wall).toBeGreaterThanOrEqual(reading);
          physical.advance();
        }
      }),
    );
  });

  it("issues timestamps after anything it has observed, even with a lagging clock", () => {
    fc.assert(
      fc.property(timestampArb, fc.integer({ min: 0, max: 20 }), (remote, localTime) => {
        const clock = new HybridLogicalClock("z", () => localTime);
        clock.observe(remote);
        expect(compareTimestamps(clock.now(), remote)).toBe(1);
      }),
      { numRuns: 1_000 },
    );
  });

  it("orders by wall, then counter, then replica", () => {
    const ts = (wall: number, counter: number, replica: string): Timestamp => ({ wall, counter, replica });
    expect(compareTimestamps(ts(1, 9, "z"), ts(2, 0, "a"))).toBe(-1);
    expect(compareTimestamps(ts(2, 1, "a"), ts(2, 0, "z"))).toBe(1);
    expect(compareTimestamps(ts(2, 1, "a"), ts(2, 1, "b"))).toBe(-1);
    expect(compareTimestamps(ts(2, 1, "a"), ts(2, 1, "a"))).toBe(0);
  });

  it("compareTimestamps is a total order (antisymmetric + transitive)", () => {
    fc.assert(
      fc.property(timestampArb, timestampArb, timestampArb, (a, b, c) => {
        // Antisymmetry: compare(a, b) and compare(b, a) always have opposite signs (or are both 0).
        expect(Math.sign(compareTimestamps(a, b)) + Math.sign(compareTimestamps(b, a))).toBe(0);
        if (compareTimestamps(a, b) <= 0 && compareTimestamps(b, c) <= 0) {
          expect(compareTimestamps(a, c)).toBeLessThanOrEqual(0);
        }
      }),
      { numRuns: 2_000 },
    );
  });

  it("rejects a broken physical clock", () => {
    expect(() => new HybridLogicalClock("a", () => Number.NaN).now()).toThrow(RangeError);
  });
});
