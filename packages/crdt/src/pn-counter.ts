import type { ReplicaId } from "./types.js";

/**
 * PN-Counter state: two grow-only counters per replica.
 * `p` counts increments, `n` counts decrements. value = sum(p) - sum(n).
 *
 * Each replica only ever writes its OWN slot, and slots only grow, so merging is
 * just "take the max of each slot". That max is what makes merge commutative,
 * associative and idempotent — i.e. a join-semilattice.
 */
export interface PNCounterState {
  readonly p: ReadonlyMap<ReplicaId, number>;
  readonly n: ReadonlyMap<ReplicaId, number>;
}

function mergeSlotsInto(target: Map<ReplicaId, number>, source: ReadonlyMap<ReplicaId, number>): void {
  for (const [replica, count] of source) {
    const current = target.get(replica);
    if (current === undefined || count > current) target.set(replica, count);
  }
}

/** Pure join of two states. */
export function mergePNCounter(a: PNCounterState, b: PNCounterState): PNCounterState {
  const p = new Map(a.p);
  const n = new Map(a.n);
  mergeSlotsInto(p, b.p);
  mergeSlotsInto(n, b.n);
  return { p, n };
}

function assertAmount(by: number): void {
  if (!Number.isSafeInteger(by) || by <= 0) {
    throw new RangeError(`amount must be a positive safe integer, got ${by}`);
  }
}

function sum(slots: ReadonlyMap<ReplicaId, number>): number {
  let total = 0;
  for (const count of slots.values()) total += count;
  return total;
}

/**
 * A delta-state PN-Counter. Every mutation returns a small delta (itself a valid
 * state) that other replicas `merge`. Deltas can arrive late, duplicated or out
 * of order — the result is the same.
 */
export class PNCounter {
  readonly replica: ReplicaId;
  readonly #p = new Map<ReplicaId, number>();
  readonly #n = new Map<ReplicaId, number>();

  constructor(replica: ReplicaId, state?: PNCounterState) {
    this.replica = replica;
    if (state) this.merge(state);
  }

  get state(): PNCounterState {
    return { p: this.#p, n: this.#n };
  }

  value(): number {
    return sum(this.#p) - sum(this.#n);
  }

  increment(by = 1): PNCounterState {
    assertAmount(by);
    const delta: PNCounterState = {
      p: new Map([[this.replica, (this.#p.get(this.replica) ?? 0) + by]]),
      n: new Map(),
    };
    this.merge(delta);
    return delta;
  }

  decrement(by = 1): PNCounterState {
    assertAmount(by);
    const delta: PNCounterState = {
      p: new Map(),
      n: new Map([[this.replica, (this.#n.get(this.replica) ?? 0) + by]]),
    };
    this.merge(delta);
    return delta;
  }

  merge(delta: PNCounterState): void {
    mergeSlotsInto(this.#p, delta.p);
    mergeSlotsInto(this.#n, delta.n);
  }
}
