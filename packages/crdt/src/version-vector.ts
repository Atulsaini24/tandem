import type { Timestamp } from "./hlc.js";
import type { ReplicaId } from "./types.js";

export interface ClockPosition {
  readonly wall: number;
  readonly counter: number;
}

function compareClock(a: ClockPosition, b: ClockPosition): number {
  if (a.wall !== b.wall) return a.wall < b.wall ? -1 : 1;
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1;
  return 0;
}

/**
 * Version Vector over HLC (wall, counter) per replica.
 *
 * Used by the sync layer to establish causal stability: if every replica in a
 * document's active set has observed up to `horizon`, any tombstone or move op
 * at or below `horizon` can never be overtaken by a concurrent older operation
 * and is safe to garbage-collect.
 */
export class VersionVector {
  readonly #entries = new Map<ReplicaId, ClockPosition>();

  constructor(initial?: Iterable<readonly [ReplicaId, ClockPosition]>) {
    if (initial) {
      for (const [replica, pos] of initial) {
        this.observe({ replica, wall: pos.wall, counter: pos.counter });
      }
    }
  }

  get entries(): ReadonlyMap<ReplicaId, ClockPosition> {
    return this.#entries;
  }

  get size(): number {
    return this.#entries.size;
  }

  get(replica: ReplicaId): ClockPosition | undefined {
    return this.#entries.get(replica);
  }

  /** Advance this vector to reflect having observed `ts`. */
  observe(ts: Timestamp): void {
    const current = this.#entries.get(ts.replica);
    const next: ClockPosition = { wall: ts.wall, counter: ts.counter };
    if (!current || compareClock(next, current) > 0) {
      this.#entries.set(ts.replica, next);
    }
  }

  /** Pointwise maximum with another VersionVector. */
  merge(other: VersionVector): void {
    for (const [replica, pos] of other.entries) {
      const current = this.#entries.get(replica);
      if (!current || compareClock(pos, current) > 0) {
        this.#entries.set(replica, pos);
      }
    }
  }

  /** True if this vector has already observed `ts` (or a newer timestamp from `ts.replica`). */
  hasSeen(ts: Timestamp): boolean {
    const current = this.#entries.get(ts.replica);
    return current !== undefined && compareClock(current, ts) >= 0;
  }

  clone(): VersionVector {
    return new VersionVector(this.#entries);
  }

  /**
   * Compute the causal stability horizon (pointwise minimum) across a non-empty
   * collection of VersionVectors. A timestamp `ts` is causally stable across all
   * replicas iff `horizon.hasSeen(ts)` is true.
   */
  static stableHorizon(vectors: Iterable<VersionVector>): VersionVector {
    const list = [...vectors];
    if (list.length === 0) return new VersionVector();

    const first = list[0];
    if (!first) return new VersionVector();
    const horizon = new VersionVector();

    for (const [replica, firstPos] of first.entries) {
      let minPos: ClockPosition | undefined = firstPos;
      for (let i = 1; i < list.length; i++) {
        const otherPos = list[i]?.get(replica);
        if (!otherPos) {
          minPos = undefined;
          break;
        }
        if (compareClock(otherPos, minPos) < 0) {
          minPos = otherPos;
        }
      }
      if (minPos) {
        horizon.observe({ replica, wall: minPos.wall, counter: minPos.counter });
      }
    }

    return horizon;
  }
}
