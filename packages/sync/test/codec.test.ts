import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { LWWMapEntry, MoveOp, Timestamp } from "@canvas/crdt";
import { CanvasDocument, type DocDelta, type PropValue } from "@canvas/doc";
import {
  DecodeError,
  decodeClientMessage,
  decodeDelta,
  decodeServerMessage,
  encodeClientMessage,
  encodeDelta,
  encodeServerMessage,
  type ClientMessage,
  type ServerMessage,
} from "../src/index.js";

const timestampArb: fc.Arbitrary<Timestamp> = fc.record({
  wall: fc.oneof(fc.nat({ max: 1000 }), fc.integer({ min: 1.7e12, max: 2e12 }), fc.constant(Number.MAX_SAFE_INTEGER)),
  counter: fc.nat({ max: 70_000 }),
  replica: fc.oneof(fc.constantFrom("a", "replica-1"), fc.string({ unit: "grapheme" })),
});

const valueArb: fc.Arbitrary<PropValue> = fc.oneof(
  fc.string({ unit: "grapheme" }),
  fc.integer(),
  fc.double(),
  // Boundary values on both sides of the zigzag range and the safe-integer range.
  fc.constantFrom(0, -0, 2 ** 52 - 1, 2 ** 52, -(2 ** 52), -(2 ** 52) - 1, 2 ** 53 - 1, -(2 ** 53), Number.NaN, Infinity, 0xffffff),
);

const entryArb: fc.Arbitrary<LWWMapEntry<PropValue>> = fc.oneof(
  fc.record({ ts: timestampArb, deleted: fc.constant(false as const), value: valueArb }),
  fc.record({ ts: timestampArb, deleted: fc.constant(true as const) }),
);

const moveArb: fc.Arbitrary<MoveOp> = fc.record({
  ts: timestampArb,
  child: fc.string(),
  parent: fc.string(),
  position: fc.string(),
});

const deltaArb: fc.Arbitrary<DocDelta> = fc.record({
  tree: fc.array(moveArb, { maxLength: 10 }),
  props: fc.array(
    fc.tuple(
      fc.string(),
      fc.array(fc.tuple(fc.string(), entryArb), { maxLength: 6 }).map((entries) => new Map(entries)),
    ),
    { maxLength: 6 },
  ),
});

function expectOnlyDecodeErrors(fn: () => unknown): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DecodeError);
  }
}

describe("delta codec", () => {
  it("round-trips any delta exactly (including -0, NaN, huge ints, emoji)", () => {
    fc.assert(
      fc.property(deltaArb, (delta) => {
        expect(decodeDelta(encodeDelta(delta))).toEqual(delta);
      }),
      { numRuns: 2_000 },
    );
  });

  it("round-trips a real document state", () => {
    const doc = new CanvasDocument("replica-x");
    doc.createShapes([{ id: "s1", props: { kind: "ellipse", x: 1.5, y: -20, w: 30, h: 40, fill: 0xdd4f78 } }]);
    doc.deleteShapes(["s1"]);
    expect(decodeDelta(encodeDelta(doc.state))).toEqual(doc.state);
  });

  it("is much smaller than JSON for a 5,000-shape create", () => {
    const doc = new CanvasDocument("8f3b2c1e-6a4d-4e9b-b0a7-3c2d1e0f9a8b");
    const delta = doc.createShapes(
      Array.from({ length: 5_000 }, (_, i) => ({
        id: crypto.randomUUID(),
        props: { kind: i % 2 ? "rect" : "ellipse", x: i * 13.37, y: i * 7.1, w: 40, h: 30, fill: 0x2f63ff },
      }) as const),
    );
    const binary = encodeDelta(delta).length;
    const json = JSON.stringify({ tree: delta.tree, props: delta.props.map(([id, m]) => [id, [...m]]) }).length;
    // Recorded in DECISIONS.md; asserted loosely so the test isn't brittle.
    console.info(`5,000-shape create: binary ${binary} B vs JSON ${json} B (${((binary / json) * 100).toFixed(1)}%)`);
    expect(binary / json).toBeLessThan(0.4);
  });

  it("throws only DecodeError on random bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), (bytes) => {
        expectOnlyDecodeErrors(() => decodeDelta(bytes));
        expectOnlyDecodeErrors(() => decodeClientMessage(bytes));
        expectOnlyDecodeErrors(() => decodeServerMessage(bytes));
      }),
      { numRuns: 5_000 },
    );
  });

  it("rejects every truncation of a valid delta", () => {
    fc.assert(
      fc.property(deltaArb, (delta) => {
        const bytes = encodeDelta(delta);
        for (let cut = 0; cut < bytes.length; cut++) {
          expect(() => decodeDelta(bytes.subarray(0, cut))).toThrow(DecodeError);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("rejects a forged huge count without allocating it", () => {
    // string-table count = 2^40, followed by nothing
    const forged = new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x20]);
    expect(() => decodeDelta(forged)).toThrow(DecodeError);
  });
});

describe("messages", () => {
  it("round-trip client and server messages", () => {
    const client: ClientMessage[] = [
      { type: "hello", version: 3, docId: "doc-1", clientId: "abc", since: 123_456, token: "t.sig" },
      { type: "push", clientSeq: 9, delta: new Uint8Array([1, 2, 3]) },
      { type: "signal", to: "peer-2", payload: new TextEncoder().encode('{"t":"sdp"}') },
    ];
    const server: ServerMessage[] = [
      { type: "welcome", head: 77, readOnly: false },
      { type: "welcome", head: 0, readOnly: true },
      { type: "delta", serverSeq: 78, delta: new Uint8Array([4, 5]) },
      { type: "ack", clientSeq: 9, serverSeq: 79 },
      { type: "error", fatal: true, message: "nope ✋" },
      { type: "signal", from: "peer-1", payload: new Uint8Array([7, 8, 9]) },
    ];
    for (const m of client) expect(decodeClientMessage(encodeClientMessage(m))).toEqual(m);
    for (const m of server) expect(decodeServerMessage(encodeServerMessage(m))).toEqual(m);
  });
});
