import type { LWWMapEntry, MoveOp, NodeId, Timestamp } from "@canvas/crdt";
import type { DocDelta, PropValue } from "@canvas/doc";

/**
 * Binary encoding for document deltas.
 *
 * Layout:  [string table] [tree ops] [property entries]
 *
 * - Integers are unsigned LEB128 varints (1 byte below 128, 7 bits per byte after).
 *   HLC wall times (~2^41) take 6 bytes instead of 13 JSON characters.
 * - Every string (replica ids, node ids, property keys, positions, string values)
 *   is written once in a table and then referenced by index. A delta that moves 500
 *   shapes mentions the replica id 1,000 times but stores it once.
 * - Property values are tagged: deleted / string / zigzag integer / float64.
 *
 * Decoding is defensive: the server decodes untrusted bytes, so every read is
 * bounds-checked, every count is checked against the bytes remaining (no giant
 * allocations from a forged length), and any malformed input throws DecodeError —
 * never anything else.
 */

export class DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecodeError";
  }
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

export class Writer {
  #buffer = new Uint8Array(256);
  #view = new DataView(this.#buffer.buffer);
  #length = 0;

  byte(value: number): void {
    this.#reserve(1);
    this.#buffer[this.#length++] = value;
  }

  /** Unsigned varint, any non-negative safe integer. */
  uint(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`not a uint: ${value}`);
    let rest = value;
    while (rest >= 0x80) {
      this.byte((rest % 0x80) | 0x80);
      rest = Math.floor(rest / 0x80);
    }
    this.byte(rest);
  }

  /** Signed varint via zigzag (0, -1, 1, -2 … → 0, 1, 2, 3 …), value in [−2^52, 2^52 − 1]. */
  int(value: number): void {
    this.uint(value >= 0 ? value * 2 : -value * 2 - 1);
  }

  f64(value: number): void {
    this.#reserve(8);
    this.#view.setFloat64(this.#length, value, true);
    this.#length += 8;
  }

  bytes(value: Uint8Array): void {
    this.#reserve(value.length);
    this.#buffer.set(value, this.#length);
    this.#length += value.length;
  }

  str(value: string): void {
    const encoded = textEncoder.encode(value);
    this.uint(encoded.length);
    this.bytes(encoded);
  }

  finish(): Uint8Array {
    return this.#buffer.slice(0, this.#length);
  }

  #reserve(extra: number): void {
    if (this.#length + extra <= this.#buffer.length) return;
    const next = new Uint8Array(Math.max(this.#buffer.length * 2, this.#length + extra));
    next.set(this.#buffer.subarray(0, this.#length));
    this.#buffer = next;
    this.#view = new DataView(next.buffer);
  }
}

export class Reader {
  readonly #bytes: Uint8Array;
  readonly #view: DataView;
  #position = 0;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number {
    return this.#bytes.length - this.#position;
  }

  byte(): number {
    const value = this.#bytes[this.#position];
    if (value === undefined) throw new DecodeError("unexpected end of input");
    this.#position += 1;
    return value;
  }

  uint(): number {
    let result = 0;
    let multiplier = 1;
    for (let i = 0; i < 8; i++) {
      const b = this.byte();
      result += (b & 0x7f) * multiplier;
      if ((b & 0x80) === 0) {
        if (!Number.isSafeInteger(result)) throw new DecodeError("varint exceeds safe integer range");
        return result;
      }
      multiplier *= 0x80;
    }
    throw new DecodeError("varint too long");
  }

  int(): number {
    const zigzag = this.uint();
    return zigzag % 2 === 0 ? zigzag / 2 : -(zigzag + 1) / 2;
  }

  f64(): number {
    if (this.remaining < 8) throw new DecodeError("unexpected end of input");
    const value = this.#view.getFloat64(this.#position, true);
    this.#position += 8;
    return value;
  }

  str(): string {
    const length = this.uint();
    if (length > this.remaining) throw new DecodeError("string length exceeds input");
    const slice = this.#bytes.subarray(this.#position, this.#position + length);
    this.#position += length;
    try {
      return textDecoder.decode(slice);
    } catch {
      throw new DecodeError("invalid UTF-8");
    }
  }

  /** A count of items, each at least `minBytes` long — rejects forged huge counts. */
  count(minBytes: number): number {
    const n = this.uint();
    if (n * minBytes > this.remaining) throw new DecodeError("count exceeds input");
    return n;
  }

  /** Everything left, copied (the caller may keep it after the input buffer is reused). */
  rest(): Uint8Array {
    const out = this.#bytes.slice(this.#position);
    this.#position = this.#bytes.length;
    return out;
  }

  end(): void {
    if (this.remaining !== 0) throw new DecodeError(`${this.remaining} trailing bytes`);
  }
}

const VALUE_DELETED = 0;
const VALUE_STRING = 1;
const VALUE_INT = 2;
const VALUE_FLOAT = 3;
/**
 * Zigzag maps v ≥ 0 to 2v and v < 0 to −2v−1; the result must stay a safe integer
 * (≤ 2^53 − 1). So the range is [−2^52, 2^52 − 1] — asymmetric, like two's complement.
 * (2^52 itself would encode as 2^53, which is not safe. The property test found this.)
 */
const ZIGZAG_MIN = -(2 ** 52);
const ZIGZAG_MAX = 2 ** 52 - 1;

function isCompactInt(value: number): boolean {
  return Number.isInteger(value) && value >= ZIGZAG_MIN && value <= ZIGZAG_MAX && !Object.is(value, -0);
}

export function encodeDelta(delta: DocDelta): Uint8Array {
  const index = new Map<string, number>();
  const table: string[] = [];
  const ref = (value: string): number => {
    let i = index.get(value);
    if (i === undefined) {
      i = table.length;
      index.set(value, i);
      table.push(value);
    }
    return i;
  };

  const body = new Writer();
  const timestamp = (ts: Timestamp): void => {
    body.uint(ts.wall);
    body.uint(ts.counter);
    body.uint(ref(ts.replica));
  };

  body.uint(delta.tree.length);
  for (const op of delta.tree) {
    timestamp(op.ts);
    body.uint(ref(op.child));
    body.uint(ref(op.parent));
    body.uint(ref(op.position));
  }

  body.uint(delta.props.length);
  for (const [id, entries] of delta.props) {
    body.uint(ref(id));
    body.uint(entries.size);
    for (const [key, entry] of entries) {
      body.uint(ref(key));
      timestamp(entry.ts);
      if (entry.deleted) {
        body.byte(VALUE_DELETED);
      } else if (typeof entry.value === "string") {
        body.byte(VALUE_STRING);
        body.uint(ref(entry.value));
      } else if (isCompactInt(entry.value)) {
        body.byte(VALUE_INT);
        body.int(entry.value);
      } else {
        body.byte(VALUE_FLOAT);
        body.f64(entry.value);
      }
    }
  }

  const out = new Writer();
  out.uint(table.length);
  for (const value of table) out.str(value);
  out.bytes(body.finish());
  return out.finish();
}

export function decodeDelta(bytes: Uint8Array): DocDelta {
  const r = new Reader(bytes);
  const table: string[] = [];
  for (let i = r.count(1); i > 0; i--) table.push(r.str());
  const ref = (): string => {
    const value = table[r.uint()];
    if (value === undefined) throw new DecodeError("string reference out of range");
    return value;
  };
  const timestamp = (): Timestamp => ({ wall: r.uint(), counter: r.uint(), replica: ref() });

  const tree: MoveOp[] = [];
  for (let i = r.count(6); i > 0; i--) {
    tree.push({ ts: timestamp(), child: ref(), parent: ref(), position: ref() });
  }

  const props: Array<readonly [NodeId, Map<string, LWWMapEntry<PropValue>>]> = [];
  for (let i = r.count(2); i > 0; i--) {
    const id = ref();
    const entries = new Map<string, LWWMapEntry<PropValue>>();
    for (let j = r.count(5); j > 0; j--) {
      const key = ref();
      const ts = timestamp();
      const tag = r.byte();
      if (tag === VALUE_DELETED) entries.set(key, { ts, deleted: true });
      else if (tag === VALUE_STRING) entries.set(key, { ts, deleted: false, value: ref() });
      else if (tag === VALUE_INT) entries.set(key, { ts, deleted: false, value: r.int() });
      else if (tag === VALUE_FLOAT) entries.set(key, { ts, deleted: false, value: r.f64() });
      else throw new DecodeError(`unknown value tag ${tag}`);
    }
    props.push([id, entries]);
  }
  r.end();
  return { tree, props };
}

/** Every timestamp in a delta (for server-side validation). */
export function timestampsOf(delta: DocDelta): Timestamp[] {
  const out: Timestamp[] = delta.tree.map((op) => op.ts);
  for (const [, entries] of delta.props) for (const entry of entries.values()) out.push(entry.ts);
  return out;
}
