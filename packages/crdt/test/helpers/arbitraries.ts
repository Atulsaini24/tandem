import fc from "fast-check";
import type { Timestamp } from "../../src/index.js";

/** Small value ranges on purpose: collisions on wall/counter are where bugs hide. */
export const timestampArb: fc.Arbitrary<Timestamp> = fc.record({
  wall: fc.integer({ min: 0, max: 20 }),
  counter: fc.nat({ max: 5 }),
  replica: fc.constantFrom("a", "b", "c"),
});
