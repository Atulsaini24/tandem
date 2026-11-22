import fc from "fast-check";

/**
 * A simulated, hostile network for convergence testing.
 *
 * A random script interleaves two kinds of steps:
 *  - "op":      a replica performs a local edit (its physical clock may also drift,
 *               including backwards) and broadcasts the resulting delta
 *  - "deliver": some already-sent delta arrives at some replica — possibly late,
 *               possibly a duplicate, possibly its own
 *
 * Finally every replica receives every delta twice, in its own random order
 * (anti-entropy). A correct CRDT must leave every replica in an identical state.
 */
export type Step<O> =
  | { readonly kind: "op"; readonly replica: number; readonly op: O; readonly dt: number }
  | { readonly kind: "deliver"; readonly to: number; readonly pick: number };

export interface Sent<D> {
  readonly from: number;
  readonly delta: D;
}

export interface Scenario<R, D, O> {
  readonly replicaCount: number;
  create(id: string, physicalNow: () => number): R;
  apply(replica: R, op: O): D;
  merge(replica: R, delta: D): void;
}

export function stepsArb<O>(op: fc.Arbitrary<O>, replicaCount: number, maxSteps = 40): fc.Arbitrary<Step<O>[]> {
  const opStep: fc.Arbitrary<Step<O>> = fc.record({
    kind: fc.constant("op" as const),
    replica: fc.nat({ max: replicaCount - 1 }),
    op,
    dt: fc.integer({ min: -5, max: 20 }),
  });
  const deliverStep: fc.Arbitrary<Step<O>> = fc.record({
    kind: fc.constant("deliver" as const),
    to: fc.nat({ max: replicaCount - 1 }),
    pick: fc.nat(),
  });
  return fc.array(fc.oneof(opStep, deliverStep), { maxLength: maxSteps });
}

export function simulate<R, D, O>(
  scenario: Scenario<R, D, O>,
  steps: readonly Step<O>[],
  seed: number,
): { replicas: R[]; sent: Sent<D>[] } {
  const physical: number[] = [];
  const replicas: R[] = [];
  for (let i = 0; i < scenario.replicaCount; i++) {
    physical.push(1_000 + i * 7); // replicas start with skewed clocks
    replicas.push(scenario.create(`r${i}`, () => at(physical, i)));
  }

  const sent: Sent<D>[] = [];
  for (const step of steps) {
    if (step.kind === "op") {
      physical[step.replica] = Math.max(0, at(physical, step.replica) + step.dt);
      sent.push({ from: step.replica, delta: scenario.apply(at(replicas, step.replica), step.op) });
    } else if (sent.length > 0) {
      scenario.merge(at(replicas, step.to), at(sent, step.pick % sent.length).delta);
    }
  }

  replicas.forEach((replica, i) => {
    const inbox = shuffle([...sent, ...sent], mulberry32(seed + i));
    for (const { delta } of inbox) scenario.merge(replica, delta);
  });

  return { replicas, sent };
}

export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new RangeError(`index ${index} out of bounds`);
  return item;
}

/** Small deterministic PRNG so failures are reproducible from fast-check's seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = at(items, i);
    items[i] = at(items, j);
    items[j] = tmp;
  }
  return items;
}

/** Convergence gate: 10,000 random histories per CRDT. */
export const CONVERGENCE_RUNS = 10_000;
export const FUZZ_TIMEOUT_MS = 120_000;
