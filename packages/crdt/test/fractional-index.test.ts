import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { isValidPosition, positionBetween } from "../src/index.js";

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
