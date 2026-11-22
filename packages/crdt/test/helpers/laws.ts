import { describe, expect, it } from "vitest";
import fc from "fast-check";

/**
 * A state-based CRDT's merge must be a join-semilattice:
 *   commutative  merge(a, b) = merge(b, a)                     → delivery order doesn't matter
 *   associative  merge(merge(a, b), c) = merge(a, merge(b, c)) → grouping doesn't matter
 *   idempotent   merge(a, a) = a                               → duplicates don't matter
 * Together these are exactly what makes convergence over an unreliable network possible.
 *
 * (Property bodies use braces on purpose: fast-check treats a returned `false` as failure.)
 */
export function describeSemilattice<S>(name: string, arb: fc.Arbitrary<S>, merge: (a: S, b: S) => S): void {
  describe(`${name} merge is a join-semilattice`, () => {
    it("is commutative", () => {
      fc.assert(
        fc.property(arb, arb, (a, b) => {
          expect(merge(a, b)).toEqual(merge(b, a));
        }),
        { numRuns: 2_000 },
      );
    });
    it("is associative", () => {
      fc.assert(
        fc.property(arb, arb, arb, (a, b, c) => {
          expect(merge(merge(a, b), c)).toEqual(merge(a, merge(b, c)));
        }),
        { numRuns: 2_000 },
      );
    });
    it("is idempotent", () => {
      fc.assert(
        fc.property(arb, (a) => {
          expect(merge(a, a)).toEqual(a);
        }),
        { numRuns: 2_000 },
      );
    });
  });
}
