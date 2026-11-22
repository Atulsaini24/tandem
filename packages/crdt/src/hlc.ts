import type { ReplicaId } from "./types.js";

/**
 * A Hybrid Logical Clock timestamp.
 *
 * - `wall`    — physical milliseconds (close to real time, so it is human-meaningful)
 * - `counter` — logical counter that breaks ties when `wall` does not advance
 * - `replica` — final tie-breaker, which makes every timestamp globally unique
 *
 * Compared lexicographically by (wall, counter, replica), this gives a TOTAL order
 * over every event in the system, which every replica agrees on.
 */
export interface Timestamp {
  readonly wall: number;
  readonly counter: number;
  readonly replica: ReplicaId;
}

/** Returns a source of physical time in milliseconds. Injected so tests can control it. */
export type PhysicalClock = () => number;

/** Total order over timestamps: negative if a < b, positive if a > b, 0 if identical. */
export function compareTimestamps(a: Timestamp, b: Timestamp): number {
  if (a.wall !== b.wall) return a.wall < b.wall ? -1 : 1;
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1;
  if (a.replica !== b.replica) return a.replica < b.replica ? -1 : 1;
  return 0;
}

/**
 * Hybrid Logical Clock (Kulkarni et al., 2014).
 *
 * Guarantees:
 * 1. Every timestamp this clock issues is strictly greater than the previous one,
 *    even if the device's physical clock jumps backwards.
 * 2. After observing a remote timestamp, every timestamp issued is strictly greater
 *    than it. So an edit made after seeing someone else's edit always "happens after"
 *    it — even if this device's clock is minutes behind.
 * 3. `wall` never falls behind the local physical clock.
 */
export class HybridLogicalClock {
  readonly replica: ReplicaId;
  readonly #physical: PhysicalClock;
  #wall = 0;
  #counter = 0;

  constructor(replica: ReplicaId, physical: PhysicalClock = Date.now) {
    this.replica = replica;
    this.#physical = physical;
  }

  /** Issue a new timestamp for a local event. */
  now(): Timestamp {
    const pt = Math.floor(this.#physical());
    if (!Number.isFinite(pt)) throw new RangeError(`physical clock returned ${pt}`);

    if (pt > this.#wall) {
      // Physical time moved forward: use it and reset the logical counter.
      this.#wall = pt;
      this.#counter = 0;
    } else {
      // Physical time stalled or went backwards: keep the old wall time, bump the counter.
      this.#counter += 1;
    }
    return { wall: this.#wall, counter: this.#counter, replica: this.replica };
  }

  /** Fold a timestamp received from another replica into this clock. */
  observe(remote: Timestamp): void {
    if (
      remote.wall > this.#wall ||
      (remote.wall === this.#wall && remote.counter > this.#counter)
    ) {
      this.#wall = remote.wall;
      this.#counter = remote.counter;
    }
  }
}
