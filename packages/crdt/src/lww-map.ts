import { compareTimestamps, type HybridLogicalClock, type Timestamp } from "./hlc.js";

/**
 * One key's latest write. Deletes are recorded as tombstones (not removed), so a
 * delete can still beat an older `set` that arrives later over the network.
 */
export type LWWMapEntry<V> =
  | { readonly ts: Timestamp; readonly deleted: false; readonly value: V }
  | { readonly ts: Timestamp; readonly deleted: true };

export type LWWMapState<V> = ReadonlyMap<string, LWWMapEntry<V>>;

function mergeInto<V>(target: Map<string, LWWMapEntry<V>>, source: LWWMapState<V>): void {
  for (const [key, entry] of source) {
    const current = target.get(key);
    if (current === undefined || compareTimestamps(entry.ts, current.ts) > 0) {
      target.set(key, entry);
    }
  }
}

/** Pure join: per key, the entry with the greatest timestamp wins. */
export function mergeLWWMap<V>(a: LWWMapState<V>, b: LWWMapState<V>): LWWMapState<V> {
  const out = new Map(a);
  mergeInto(out, b);
  return out;
}

/**
 * Last-Writer-Wins Map: one LWW register per key. This holds a shape's properties:
 * two users changing `color` and `x` at the same time both keep their change,
 * because each key resolves independently.
 */
export class LWWMap<V> {
  readonly clock: HybridLogicalClock;
  readonly #entries = new Map<string, LWWMapEntry<V>>();

  constructor(clock: HybridLogicalClock, state?: LWWMapState<V>) {
    this.clock = clock;
    if (state) this.merge(state);
  }

  /** Full internal state, including tombstones. Read-only view. */
  get state(): LWWMapState<V> {
    return this.#entries;
  }

  get(key: string): V | undefined {
    const entry = this.#entries.get(key);
    return entry && !entry.deleted ? entry.value : undefined;
  }

  has(key: string): boolean {
    const entry = this.#entries.get(key);
    return entry !== undefined && !entry.deleted;
  }

  /** Live (non-deleted) entries, sorted by key so iteration order is deterministic. */
  entries(): Array<readonly [string, V]> {
    return [...this.#entries]
      .flatMap(([key, entry]) => (entry.deleted ? [] : [[key, entry.value] as const]))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  }

  set(key: string, value: V): LWWMapState<V> {
    return this.#write(key, { ts: this.clock.now(), deleted: false, value });
  }

  delete(key: string): LWWMapState<V> {
    return this.#write(key, { ts: this.clock.now(), deleted: true });
  }

  merge(delta: LWWMapState<V>): void {
    for (const entry of delta.values()) this.clock.observe(entry.ts);
    mergeInto(this.#entries, delta);
  }

  #write(key: string, entry: LWWMapEntry<V>): LWWMapState<V> {
    const delta: LWWMapState<V> = new Map([[key, entry]]);
    this.merge(delta);
    return delta;
  }
}
