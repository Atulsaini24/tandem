import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { isValidPosition, positionBetween, positionsBetween } from "../src/index.js";

describe("positionsBetween", () => {
  it("generates n ordered, valid, unique positions inside the bounds", () => {
    fc.assert(
      fc.property(fc.nat({ max: 300 }), fc.boolean(), (count, bounded) => {
        const low = bounded ? positionBetween(null, null) : null;
        const high = bounded && low !== null ? positionBetween(low, null) : null;
        const keys = positionsBetween(low, high, count);
        expect(keys).toHaveLength(count);
        keys.forEach((key, i) => {
          expect(isValidPosition(key)).toBe(true);
          if (i > 0) expect((keys[i - 1] ?? "") < key).toBe(true);
          if (low !== null) expect(key > low).toBe(true);
          if (high !== null) expect(key < high).toBe(true);
        });
      }),
    );
  });

  it("keeps keys short for 5,000 items", () => {
    const keys = positionsBetween(null, null, 5_000);
    expect(Math.max(...keys.map((key) => key.length))).toBeLessThanOrEqual(6);
  });
});

describe("positionBetween", () => {
  it("generates a first position", () => {
    expect(isValidPosition(positionBetween(null, null))).toBe(true);
  });

  it("inserts before, after and between", () => {
    const mid = positionBetween(null, null);
    const before = positionBetween(null, mid);
    const after = positionBetween(mid, null);
    const between = positionBetween(before, mid);
    expect([after, between, before, mid].sort()).toEqual([before, between, mid, after]);
  });

  it("keeps finding room in the same gap (keys grow, never collide)", () => {
    let low = positionBetween(null, null);
    const high = positionBetween(low, null);
    for (let i = 0; i < 200; i++) {
      const next = positionBetween(low, high);
      expect(next > low && next < high).toBe(true);
      low = next;
    }
  });

  it("rejects invalid or out-of-order bounds", () => {
    expect(() => positionBetween("b", "a")).toThrow(RangeError);
    expect(() => positionBetween("a", "a")).toThrow(RangeError);
    expect(() => positionBetween("a0", null)).toThrow(RangeError); // trailing zero
    expect(() => positionBetween("a-", null)).toThrow(RangeError); // bad digit
  });

  it("any sequence of inserts at random indexes stays strictly ordered and valid", () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { minLength: 1, maxLength: 300 }), (picks) => {
        const keys: string[] = [];
        for (const pick of picks) {
          const index = pick % (keys.length + 1);
          const key = positionBetween(keys[index - 1] ?? null, keys[index] ?? null);
          expect(isValidPosition(key)).toBe(true);
          keys.splice(index, 0, key);
        }
        for (let i = 1; i < keys.length; i++) {
          expect((keys[i - 1] ?? "") < (keys[i] ?? "")).toBe(true);
        }
      }),
      { numRuns: 1_000 },
    );
  });
});
