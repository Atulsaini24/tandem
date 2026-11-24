import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DecodeError, MAX_PRESENCE_SELECTION, decodePresence, encodePresence, type Presence } from "../src/index.js";

const presenceArb: fc.Arbitrary<Presence> = fc.record({
  name: fc.string({ unit: "grapheme", maxLength: 40 }),
  color: fc.integer({ min: 0, max: 0xffffff }),
  cursor: fc.option(fc.record({ x: fc.double({ noNaN: true, noDefaultInfinity: true }), y: fc.double({ noNaN: true, noDefaultInfinity: true }) }), { nil: null }),
  selection: fc.array(fc.uuid(), { maxLength: 20 }),
}).chain((base) =>
  fc
    .record(
      {
        view: fc.record({ x: fc.integer(), y: fc.integer(), w: fc.nat(), h: fc.nat() }),
        chat: fc.string({ unit: "grapheme", minLength: 1, maxLength: 120 }),
        reaction: fc.record({ emoji: fc.constantFrom("🎉", "❤️", "👍", "🔥"), n: fc.nat({ max: 999_999 }) }),
        spotlight: fc.constant(true),
        laser: fc.constant(true),
        call: fc.constant(true),
      },
      { requiredKeys: [] },
    )
    .map((extra) => ({ ...base, ...extra })),
);

describe("presence codec", () => {
  it("round-trips", () => {
    fc.assert(
      fc.property(presenceArb, (presence) => {
        expect(decodePresence(encodePresence(presence))).toEqual(presence);
      }),
    );
  });

  it("caps oversized names and selections instead of sending them", () => {
    const decoded = decodePresence(
      encodePresence({ name: "x".repeat(500), color: 0xffffff, cursor: null, selection: Array.from({ length: 1_000 }, (_, i) => `s${i}`) }),
    );
    expect(decoded.name).toHaveLength(40);
    expect(decoded.selection).toHaveLength(MAX_PRESENCE_SELECTION);
  });

  it("drops a non-finite cursor rather than encoding it", () => {
    expect(decodePresence(encodePresence({ name: "a", color: 0, cursor: { x: Number.NaN, y: 1 }, selection: [] })).cursor).toBeNull();
  });

  it("throws only DecodeError on random bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 120 }), (bytes) => {
        try {
          decodePresence(bytes);
        } catch (error) {
          expect(error).toBeInstanceOf(DecodeError);
        }
      }),
      { numRuns: 3_000 },
    );
  });
});
