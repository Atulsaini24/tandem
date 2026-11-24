import { compareTimestamps, type HybridLogicalClock, type Timestamp } from "./hlc.js";
import type { VersionVector } from "./version-vector.js";

/**
 * Replicated tree with a safe concurrent MOVE operation.
 *
 * Algorithm: Kleppmann, Mulligan, Gomes, Beresford — "A highly-available move
 * operation for replicated trees" (IEEE TPDS, 2021).
 *
 * The problem: Alice moves group A into group B while Bob concurrently moves B into A.
 * Applying both naively creates a cycle (A ⊂ B ⊂ A) and the shapes vanish from the
 * canvas. Last-writer-wins on "parent" alone does not prevent this.
 *
 * The idea:
 *  1. Every replica keeps a log of move ops sorted by HLC timestamp.
 *  2. An op that arrives late is slotted into its place in timestamp order by
 *     UNDOING every newer op, APPLYING it, then REDOING the newer ops.
 *  3. When an op is (re)applied, it is SKIPPED if it would create a cycle — and it
 *     is re-evaluated against the then-current tree every time it is redone.
 * Every replica therefore applies the same ops in the same order with the same
 * skip decisions, so every replica builds the same tree.
 *
 * As a delta-state CRDT: the state is the SET of ops, merge is set union, and the
 * tree is a deterministic function of that set.
 */

export type NodeId = string;

/** Top of the visible document. Never moved. */
export const ROOT: NodeId = "__root__";
/** Deleted nodes are moved here, so a delete is just a move (and can be undone). */
export const TRASH: NodeId = "__trash__";

export interface MoveOp {
  readonly ts: Timestamp;
  readonly child: NodeId;
  readonly parent: NodeId;
  /** Fractional-index position among siblings (see fractional-index.ts). */
  readonly position: string;
}

export type TreeDelta = readonly MoveOp[];

export interface TreeNode {
  readonly parent: NodeId;
  readonly position: string;
}

interface LogEntry {
  readonly op: MoveOp;
  /** The child's placement before this op ran, needed to undo it. */
  readonly previous: TreeNode | undefined;
  /** Which op had placed the child before this one (for placedBy). */
  readonly previousTs: Timestamp | undefined;
}

export class TreeCycleError extends Error {
  constructor(child: NodeId, parent: NodeId) {
    super(`moving "${child}" under "${parent}" would create a cycle`);
    this.name = "TreeCycleError";
  }
}

function isReserved(id: NodeId): boolean {
  return id === ROOT || id === TRASH;
}

function timestampKey(ts: Timestamp): string {
  return `${ts.wall}:${ts.counter}:${ts.replica}`;
}

function compareOps(a: MoveOp, b: MoveOp): number {
  return compareTimestamps(a.ts, b.ts);
}

export class MoveTree {
  readonly clock: HybridLogicalClock;
  /** Applied ops, ascending by timestamp. */
  readonly #log: LogEntry[] = [];
  readonly #nodes = new Map<NodeId, TreeNode>();
  /** parent → children index, so `children()` doesn't scan every node. */
  readonly #children = new Map<NodeId, Set<NodeId>>();
  /** The timestamp of the op that currently determines each node's placement. */
  readonly #placedBy = new Map<NodeId, Timestamp>();
  readonly #seen = new Set<string>();

  constructor(clock: HybridLogicalClock, ops?: TreeDelta) {
    this.clock = clock;
    if (ops) this.merge(ops);
  }

  /** Every op this replica knows about: the full CRDT state, ready to sync. */
  get ops(): TreeDelta {
    return this.#log.map((entry) => entry.op);
  }

  get(id: NodeId): TreeNode | undefined {
    return this.#nodes.get(id);
  }

  /** All placed nodes, sorted by id (deterministic, for snapshots and tests). */
  nodes(): Array<readonly [NodeId, TreeNode]> {
    return [...this.#nodes].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  }

  /** Children in sibling order: by position, ties broken by node id. */
  children(parent: NodeId): NodeId[] {
    const result: Array<[NodeId, string]> = [];
    for (const id of this.#children.get(parent) ?? []) {
      const node = this.#nodes.get(id);
      if (node) result.push([id, node.position]);
    }
    return result
      .sort(([idA, posA], [idB, posB]) =>
        posA !== posB ? (posA < posB ? -1 : 1) : idA < idB ? -1 : idA > idB ? 1 : 0,
      )
      .map(([id]) => id);
  }

  /**
   * The op currently in effect for a node's placement. Selective undo uses it: "is my
   * move still the one that counts?" If someone moved the node since, the answer is
   * no, and undoing my move must not yank it back.
   */
  placedBy(id: NodeId): Timestamp | undefined {
    return this.#placedBy.get(id);
  }

  /** True if `ancestor` is `node` itself or any node above it. */
  isAncestor(ancestor: NodeId, node: NodeId): boolean {
    let current: NodeId = node;
    // The tree is acyclic by construction; the bound turns a bug into a loud error
    // instead of an infinite loop.
    for (let steps = 0; steps <= this.#nodes.size + 1; steps++) {
      if (current === ancestor) return true;
      const placed = this.#nodes.get(current);
      if (!placed) return false;
      current = placed.parent;
    }
    throw new Error("cycle detected in move tree (invariant violated)");
  }

  /** True if the node is reachable from ROOT (i.e. visible, not deleted or orphaned). */
  isAttached(id: NodeId): boolean {
    return id === ROOT || (this.#nodes.has(id) && this.isAncestor(ROOT, id));
  }

  /**
   * Create or move a node. Throws if the move is invalid *locally* — the UI should
   * never let a user drop a group into itself. Concurrent remote ops that create a
   * cycle are not errors: they are skipped deterministically during merge.
   */
  move(child: NodeId, parent: NodeId, position: string): TreeDelta {
    if (isReserved(child)) throw new RangeError(`"${child}" cannot be moved`);
    if (this.isAncestor(child, parent)) throw new TreeCycleError(child, parent);
    const op: MoveOp = { ts: this.clock.now(), child, parent, position };
    this.merge([op]);
    return [op];
  }

  /** Delete = move to TRASH. The whole subtree goes with it. */
  delete(child: NodeId): TreeDelta {
    return this.move(child, TRASH, "a0");
  }

  merge(delta: TreeDelta): void {
    for (const op of [...delta].sort(compareOps)) this.#integrate(op);
  }

  /**
   * Garbage-collect causally stable deleted nodes (in TRASH with no remaining children)
   * and compact superseded log entries within the causally stable prefix.
   */
  gc(horizon: VersionVector): number {
    // Find the contiguous prefix [0..stableEnd) where every op is causally stable.
    let stableEnd = 0;
    while (stableEnd < this.#log.length) {
      const entry = this.#log[stableEnd];
      if (!entry || !horizon.hasSeen(entry.op.ts)) break;
      stableEnd += 1;
    }
    if (stableEnd === 0) return 0;

    // Any node referenced in the unstable tail [stableEnd..) must not be purged yet.
    const referencedInTail = new Set<NodeId>();
    for (let i = stableEnd; i < this.#log.length; i++) {
      const entry = this.#log[i];
      if (!entry) continue;
      referencedInTail.add(entry.op.child);
      referencedInTail.add(entry.op.parent);
    }

    // Track which ops in the stable prefix are the latest active placement for a node.
    const activeOpTs = new Map<NodeId, string>();
    for (const [id, ts] of this.#placedBy) {
      activeOpTs.set(id, timestampKey(ts));
    }

    // Purge nodes that are in TRASH, have no children, and are not referenced in the unstable tail.
    const purgedNodes = new Set<NodeId>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of this.#children.get(TRASH) ?? []) {
        if (purgedNodes.has(id) || referencedInTail.has(id)) continue;
        const hasChildren = (this.#children.get(id)?.size ?? 0) > 0;
        if (hasChildren) continue;
        const placedTs = this.#placedBy.get(id);
        if (placedTs && horizon.hasSeen(placedTs)) {
          purgedNodes.add(id);
          this.#place(id, undefined);
          this.#placedBy.delete(id);
          changed = true;
        }
      }
    }

    // Compact the stable prefix: drop ops for purged nodes and superseded ops.
    let collected = 0;
    const keptPrefix: LogEntry[] = [];
    for (let i = 0; i < stableEnd; i++) {
      const entry = this.#log[i];
      if (!entry) continue;
      const child = entry.op.child;
      if (purgedNodes.has(child)) {
        collected += 1;
        continue;
      }
      if (activeOpTs.get(child) !== timestampKey(entry.op.ts) && !referencedInTail.has(child)) {
        collected += 1;
        continue;
      }
      // Clear undo metadata for stable ops since we will never undo into the stable prefix.
      keptPrefix.push({ op: entry.op, previous: undefined, previousTs: undefined });
    }

    if (collected > 0 || keptPrefix.length < stableEnd) {
      const tail = this.#log.slice(stableEnd);
      this.#log.length = 0;
      this.#log.push(...keptPrefix, ...tail);
    }
    return collected;
  }

  #integrate(op: MoveOp): void {
    const key = timestampKey(op.ts);
    if (this.#seen.has(key)) return; // duplicate delivery
    this.#seen.add(key);
    this.clock.observe(op.ts);

    // Undo every op newer than this one (newest first)...
    let index = this.#log.length;
    while (index > 0) {
      const newer = this.#log[index - 1];
      if (!newer || compareOps(newer.op, op) <= 0) break;
      this.#undo(newer);
      index--;
    }
    // ...apply this op, then redo the newer ones (oldest first), re-checking each
    // against the tree as it now is.
    const toRedo = this.#log.splice(index);
    this.#log.push(this.#apply(op));
    for (const entry of toRedo) this.#log.push(this.#apply(entry.op));
  }

  #apply(op: MoveOp): LogEntry {
    const previous = this.#nodes.get(op.child);
    const previousTs = this.#placedBy.get(op.child);
    const createsCycle = this.isAncestor(op.child, op.parent);
    if (!isReserved(op.child) && !createsCycle) {
      this.#place(op.child, { parent: op.parent, position: op.position });
      this.#placedBy.set(op.child, op.ts);
    }
    return { op, previous, previousTs };
  }

  #undo(entry: LogEntry): void {
    this.#place(entry.op.child, entry.previous);
    if (entry.previousTs === undefined) this.#placedBy.delete(entry.op.child);
    else this.#placedBy.set(entry.op.child, entry.previousTs);
  }

  /** The only place nodes change, so the children index can never drift. */
  #place(child: NodeId, node: TreeNode | undefined): void {
    const before = this.#nodes.get(child);
    if (before) this.#children.get(before.parent)?.delete(child);
    if (node === undefined) {
      this.#nodes.delete(child);
      return;
    }
    this.#nodes.set(child, node);
    const siblings = this.#children.get(node.parent) ?? new Set<NodeId>();
    siblings.add(child);
    this.#children.set(node.parent, siblings);
  }
}
