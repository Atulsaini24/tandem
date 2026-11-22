import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { CRDT_VERSION } from "../src/index.js";

describe("toolchain smoke test", () => {
  it("imports the package", () => {
    expect(CRDT_VERSION).toBe("0.0.0");
  });

  it("runs property-based tests", () => {
    // Sanity check that fast-check is wired up: addition is commutative.
    fc.assert(fc.property(fc.integer(), fc.integer(), (a, b) => a + b === b + a));
  });
});
