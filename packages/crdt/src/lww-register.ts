import { compareTimestamps, type HybridLogicalClock, type Timestamp } from "./hlc.js";

/** One write: the value plus the HLC timestamp of the moment it was written. */
export interface LWWEntry<T> {
  readonly value: T;
  readonly ts: Timestamp;
}

/**
 * Pure join: the entry with the greater timestamp wins.
 *
 * Because HLC timestamps are globally unique, two different writes never tie,
 * so every replica picks the same winner regardless of delivery order.
 */
export function mergeLWWEntry<T>(a: LWWEntry<T>, b: LWWEntry<T>): LWWEntry<T> {
  return compareTimestamps(b.ts, a.ts) > 0 ? b : a;
}

/**
 * Last-Writer-Wins Register: a single value many replicas can overwrite.
 * Used for one shape property (x, y, color...) when concurrent writes are rare
 * and "latest wins" is what the user expects.
 */
export class LWWRegister<T> {
  readonly clock: HybridLogicalClock;
  #entry: LWWEntry<T> | undefined;

  constructor(clock: HybridLogicalClock, state?: LWWEntry<T>) {
    this.clock = clock;
    if (state) this.merge(state);
  }

  get state(): LWWEntry<T> | undefined {
    return this.#entry;
  }

  value(): T | undefined {
    return this.#entry?.value;
  }

  set(value: T): LWWEntry<T> {
    const delta: LWWEntry<T> = { value, ts: this.clock.now() };
    this.merge(delta);
    return delta;
  }

  merge(delta: LWWEntry<T>): void {
    // Observing remote timestamps is what guarantees causality: our next write
    // will be timestamped after everything we have already seen.
    this.clock.observe(delta.ts);
    this.#entry = this.#entry ? mergeLWWEntry(this.#entry, delta) : delta;
  }
}
