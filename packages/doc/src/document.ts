import {
  HybridLogicalClock,
  LWWMap,
  MoveTree,
  ROOT,
  TreeCycleError,
  compareTimestamps,
  positionsBetween,
  type LWWMapEntry,
  type LWWMapState,
  type MoveOp,
  type NodeId,
  type PhysicalClock,
  type ReplicaId,
  type Timestamp,
  type TreeDelta,
  type TreeNode,
} from "@canvas/crdt";

/**
 * The canvas document: a composition of CRDTs.
 *
 *   structure  → one MoveTree (parent + z-order of every shape)
 *   properties → one LWWMap per shape (kind, x, y, w, h, fill)
 *
 * They share one HLC, so timestamps across both are comparable. Moving a shape and
 * recoloring it concurrently touch different CRDTs and can never conflict.
 *
 * It also keeps this replica's undo/redo history (see "Selective undo" below).
 */

export type ShapeKind = "rect" | "ellipse";
export const SHAPE_KINDS: readonly ShapeKind[] = ["rect", "ellipse"];

export interface ShapeProps {
  readonly kind: ShapeKind;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** 0xRRGGBB */
  readonly fill: number;
  /** Text shown on the shape (sticky notes, AI boards). Last writer wins. */
  readonly label?: string;
}

export interface ShapeView extends ShapeProps {
  readonly id: NodeId;
}

export type PropValue = string | number;
export type PropsDelta = ReadonlyArray<readonly [NodeId, LWWMapState<PropValue>]>;

export interface DocDelta {
  readonly tree: TreeDelta;
  readonly props: PropsDelta;
}

export const EMPTY_DELTA: DocDelta = { tree: [], props: [] };

export interface EditOptions {
  /** Edits with the same group id (e.g. every step of one drag) undo as one step. */
  readonly group?: number;
}

export interface UndoResult {
  /** The writes that performed the undo/redo: sync them like any local edit. */
  readonly delta: DocDelta;
  /**
   * Shapes (not individual properties) left fully or partly alone because someone else
   * has edited them since. Counted per shape because that's how people think about it.
   */
  readonly skipped: number;
}

const PROP_KEYS = ["kind", "x", "y", "w", "h", "fill", "label"] as const satisfies ReadonlyArray<keyof ShapeProps>;
export const MAX_LABEL_CHARS = 500;
const MAX_UNDO = 200;

/** Every shape id a delta touches: its structure, its properties, or both. */
export function touchedIds(delta: DocDelta): Set<NodeId> {
  const ids = new Set<NodeId>();
  for (const op of delta.tree) ids.add(op.child);
  for (const [id] of delta.props) ids.add(id);
  return ids;
}

/** Throws on values the UI must never produce. */
export function validatePatch(patch: Partial<ShapeProps>): void {
  if (patch.kind !== undefined && !SHAPE_KINDS.includes(patch.kind)) {
    throw new RangeError(`unknown shape kind "${String(patch.kind)}"`);
  }
  for (const key of ["x", "y"] as const) {
    const value = patch[key];
    if (value !== undefined && !Number.isFinite(value)) throw new RangeError(`${key} must be finite`);
  }
  for (const key of ["w", "h"] as const) {
    const value = patch[key];
    if (value !== undefined && !(Number.isFinite(value) && value > 0)) {
      throw new RangeError(`${key} must be a positive number`);
    }
  }
  const fill = patch.fill;
  if (fill !== undefined && !(Number.isInteger(fill) && fill >= 0 && fill <= 0xffffff)) {
    throw new RangeError("fill must be an integer 0x000000–0xFFFFFF");
  }
  const label = patch.label;
  if (label !== undefined && (typeof label !== "string" || Array.from(label).length > MAX_LABEL_CHARS)) {
    throw new RangeError(`label must be a string of at most ${MAX_LABEL_CHARS} characters`);
  }
}

/**
 * Read a shape from its property map. Remote data is untrusted, so anything
 * incomplete or malformed is treated as "not a renderable shape" rather than a crash.
 */
function readShape(id: NodeId, props: LWWMap<PropValue>): ShapeView | undefined {
  const kind = props.get("kind");
  const [x, y, w, h, fill] = (["x", "y", "w", "h", "fill"] as const).map((key) => props.get(key));
  if (kind !== "rect" && kind !== "ellipse") return undefined;
  if (typeof x !== "number" || typeof y !== "number") return undefined;
  if (typeof w !== "number" || typeof h !== "number" || typeof fill !== "number") return undefined;
  const label = props.get("label");
  return typeof label === "string" && label.length > 0 ? { id, kind, x, y, w, h, fill, label } : { id, kind, x, y, w, h, fill };
}

// --- Selective undo ----------------------------------------------------------
//
// An undo step remembers, for every value this replica wrote: the timestamp of that
// write and the value it replaced. Undoing restores a value ONLY if that write is
// still the one in effect. If anyone has written it since, theirs is newer and it stays.
// That is what "undo only affects your own edits" means precisely: you can't clobber
// a collaborator's later change by pressing Ctrl+Z.
//
// The restore is a NEW write (new timestamp) that syncs like any other edit. Undo never
// rewrites history, which is the only thing that's safe in a replicated system.

interface PropChange {
  readonly id: NodeId;
  readonly key: string;
  /** Timestamp of our write. */
  readonly ts: Timestamp;
  /** The value it replaced (undefined = the key didn't exist). */
  readonly before: PropValue | undefined;
  /** Timestamp of the write it replaced. See #retarget. */
  readonly beforeTs: Timestamp | undefined;
}

interface TreeChange {
  readonly id: NodeId;
  readonly ts: Timestamp;
  /** The placement it replaced (undefined = the node didn't exist). */
  readonly before: TreeNode | undefined;
  readonly beforeTs: Timestamp | undefined;
}

interface UndoEntry {
  readonly group: number | undefined;
  readonly props: Map<string, PropChange>;
  readonly tree: Map<NodeId, TreeChange>;
}

interface ChangeSet {
  readonly props: PropChange[];
  readonly tree: TreeChange[];
}

const newEntry = (group: number | undefined): UndoEntry => ({ group, props: new Map(), tree: new Map() });
const propKey = (id: NodeId, key: string): string => `${id}\u0000${key}`;

export class CanvasDocument {
  readonly clock: HybridLogicalClock;
  readonly #tree: MoveTree;
  readonly #props = new Map<NodeId, LWWMap<PropValue>>();
  #undoStack: UndoEntry[] = [];
  #redoStack: UndoEntry[] = [];

  constructor(replica: ReplicaId, physical?: PhysicalClock) {
    this.clock = new HybridLogicalClock(replica, physical);
    this.#tree = new MoveTree(this.clock);
  }

  /** Full state of both CRDTs, ready to send to a peer or persist. */
  get state(): DocDelta {
    return {
      tree: this.#tree.ops,
      props: [...this.#props].map(([id, map]) => [id, map.state] as const),
    };
  }

  /** Only the ops a given replica authored (for re-seeding a server that lost data). */
  authoredBy(replica: ReplicaId): DocDelta {
    const props: Array<readonly [NodeId, LWWMapState<PropValue>]> = [];
    for (const [id, map] of this.#props) {
      const mine = new Map([...map.state].filter(([, entry]) => entry.ts.replica === replica));
      if (mine.size > 0) props.push([id, mine]);
    }
    return { tree: this.#tree.ops.filter((op) => op.ts.replica === replica), props };
  }

  get canUndo(): boolean {
    return this.#undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.#redoStack.length > 0;
  }

  /** Add shapes on top of everything else, in the given order. */
  createShapes(shapes: ReadonlyArray<{ readonly id: NodeId; readonly props: ShapeProps }>, options?: EditOptions): DocDelta {
    for (const shape of shapes) {
      validatePatch(shape.props);
      if (this.#tree.get(shape.id) || this.#props.has(shape.id)) {
        throw new RangeError(`shape "${shape.id}" already exists`);
      }
    }
    const changes: ChangeSet = { props: [], tree: [] };
    const positions = positionsBetween(this.#lastPosition(ROOT), null, shapes.length);
    const tree: MoveOp[] = [];
    const props: Array<readonly [NodeId, LWWMapState<PropValue>]> = [];
    shapes.forEach((shape, i) => {
      const position = positions[i];
      if (position === undefined) throw new Error("position generation mismatch");
      props.push([shape.id, this.#write(shape.id, shape.props, changes)]);
      tree.push(...this.#move(shape.id, ROOT, position, changes));
    });
    this.#record(changes, options);
    return { tree, props };
  }

  /** Change properties. Unknown ids are skipped (they may have been deleted remotely). */
  updateShapes(
    updates: ReadonlyArray<{ readonly id: NodeId; readonly patch: Partial<ShapeProps> }>,
    options?: EditOptions,
  ): DocDelta {
    const changes: ChangeSet = { props: [], tree: [] };
    const props: Array<readonly [NodeId, LWWMapState<PropValue>]> = [];
    for (const { id, patch } of updates) {
      validatePatch(patch);
      if (!this.#props.has(id)) continue;
      props.push([id, this.#write(id, patch, changes)]);
    }
    this.#record(changes, options);
    return { tree: [], props };
  }

  deleteShapes(ids: Iterable<NodeId>, options?: EditOptions): DocDelta {
    const changes: ChangeSet = { props: [], tree: [] };
    const tree: MoveOp[] = [];
    for (const id of ids) {
      if (!this.#tree.isAttached(id)) continue;
      tree.push(...this.#trash(id, changes));
    }
    this.#record(changes, options);
    return { tree, props: [] };
  }

  /** Move shapes above everything else, keeping their relative order. */
  bringToFront(ids: Iterable<NodeId>, options?: EditOptions): DocDelta {
    const wanted = new Set(ids);
    const ordered = this.#tree.children(ROOT).filter((id) => wanted.has(id));
    const positions = positionsBetween(this.#lastPosition(ROOT), null, ordered.length);
    const changes: ChangeSet = { props: [], tree: [] };
    const tree: MoveOp[] = [];
    ordered.forEach((id, i) => {
      const position = positions[i];
      if (position !== undefined) tree.push(...this.#move(id, ROOT, position, changes));
    });
    this.#record(changes, options);
    return { tree, props: [] };
  }

  /**
   * Make the document look like `version` (e.g. a point in history): restore shapes that
   * were deleted since, revert changed properties, remove shapes added since, and restore
   * the stacking order. All of it is ONE undo step, so a restore can itself be undone.
   */
  restoreTo(version: readonly ShapeView[], options?: EditOptions): DocDelta {
    const changes: ChangeSet = { props: [], tree: [] };
    const tree: MoveOp[] = [];
    const props: Array<readonly [NodeId, LWWMapState<PropValue>]> = [];
    const wanted = new Set(version.map((shape) => shape.id));

    for (const live of this.shapes()) {
      if (!wanted.has(live.id)) tree.push(...this.#trash(live.id, changes));
    }

    const current = new Map(this.shapes().map((shape) => [shape.id, shape]));
    const order = this.shapes().map((shape) => shape.id).filter((id) => wanted.has(id));
    const sameOrder = order.length === version.length && order.every((id, i) => id === version[i]?.id);
    const positions = sameOrder ? [] : positionsBetween(null, null, version.length);

    version.forEach((shape, i) => {
      const { id, ...target } = shape;
      validatePatch(target);
      const live = current.get(id);
      const patch: Partial<Record<keyof ShapeProps, PropValue>> = {};
      for (const key of PROP_KEYS) {
        // A label that didn't exist in the version is cleared (empty = no label).
        const wanted = key === "label" ? (target.label ?? "") : target[key];
        const current = key === "label" ? (live?.label ?? "") : live?.[key];
        if (live === undefined || current !== wanted) patch[key] = wanted;
      }
      if (Object.keys(patch).length > 0) props.push([id, this.#write(id, patch as Partial<ShapeProps>, changes)]);
      // positions is empty only when every version shape is already live in the same
      // order: then structure is untouched. Otherwise every shape gets a fresh position
      // in version order (which also re-attaches shapes deleted since).
      const position = positions[i];
      if (position !== undefined) tree.push(...this.#move(id, ROOT, position, changes));
    });

    this.#record(changes, options);
    return { tree, props };
  }

  /** Undo this replica's most recent edit step. */
  undo(): UndoResult | undefined {
    const entry = this.#undoStack.pop();
    if (!entry) return undefined;
    const { result, inverse } = this.#revert(entry);
    if (inverse) this.#redoStack.push(inverse);
    return result;
  }

  redo(): UndoResult | undefined {
    const entry = this.#redoStack.pop();
    if (!entry) return undefined;
    const { result, inverse } = this.#revert(entry);
    if (inverse) this.#undoStack.push(inverse);
    return result;
  }

  /** Apply a delta from another replica. Returns the ids whose view may have changed. */
  merge(delta: DocDelta): Set<NodeId> {
    this.#tree.merge(delta.tree);
    for (const [id, state] of delta.props) this.#propsOf(id).merge(state);
    return touchedIds(delta);
  }

  /** The shape as it should render, or undefined if deleted / not (yet) complete. */
  shape(id: NodeId): ShapeView | undefined {
    if (!this.#tree.isAttached(id)) return undefined;
    const props = this.#props.get(id);
    return props && readShape(id, props);
  }

  /** Every visible shape, back to front (render order). */
  shapes(): ShapeView[] {
    const out: ShapeView[] = [];
    const stack = this.#tree.children(ROOT).reverse();
    for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
      const props = this.#props.get(id);
      const view = props && readShape(id, props);
      if (view) out.push(view);
      stack.push(...this.#tree.children(id).reverse());
    }
    return out;
  }

  // --- internals -----------------------------------------------------------

  /** Write properties, recording what each key held before. */
  #write(id: NodeId, patch: Partial<Record<keyof ShapeProps, PropValue>>, changes: ChangeSet): LWWMapState<PropValue> {
    const props = this.#propsOf(id);
    const delta = new Map<string, LWWMapEntry<PropValue>>();
    for (const key of PROP_KEYS) {
      const value = patch[key];
      if (value === undefined) continue;
      const before = props.get(key);
      const beforeTs = props.state.get(key)?.ts;
      for (const [k, entry] of props.set(key, value)) {
        delta.set(k, entry);
        changes.props.push({ id, key: k, ts: entry.ts, before, beforeTs });
      }
    }
    return delta;
  }

  /** Move a node, recording where it was before. */
  #move(id: NodeId, parent: NodeId, position: string, changes: ChangeSet): MoveOp[] {
    const before = this.#tree.get(id);
    const beforeTs = this.#tree.placedBy(id);
    const ops = [...this.#tree.move(id, parent, position)];
    for (const op of ops) changes.tree.push({ id, ts: op.ts, before, beforeTs });
    return ops;
  }

  /** Delete (move to TRASH), recording where it was before. */
  #trash(id: NodeId, changes: ChangeSet): MoveOp[] {
    const before = this.#tree.get(id);
    const beforeTs = this.#tree.placedBy(id);
    const ops = [...this.#tree.delete(id)];
    for (const op of ops) changes.tree.push({ id, ts: op.ts, before, beforeTs });
    return ops;
  }

  /**
   * An undo/redo just restored a value that was originally written at `from`, under a
   * new timestamp `to`. Any other undo/redo step that refers to the `from` write must
   * now refer to `to`: the restored value IS that write, back in effect.
   * Without this, "create, delete, undo, undo" fails: the second undo would see the
   * restore's new timestamp, think someone else changed the shape, and skip it.
   */
  #retarget(kind: "prop" | "tree", key: string, from: Timestamp, to: Timestamp): void {
    for (const stack of [this.#undoStack, this.#redoStack]) {
      for (const entry of stack) {
        if (kind === "prop") {
          const change = entry.props.get(key);
          if (change && compareTimestamps(change.ts, from) === 0) entry.props.set(key, { ...change, ts: to });
        } else {
          const change = entry.tree.get(key);
          if (change && compareTimestamps(change.ts, from) === 0) entry.tree.set(key, { ...change, ts: to });
        }
      }
    }
  }

  #record(changes: ChangeSet, options: EditOptions | undefined): void {
    if (changes.props.length === 0 && changes.tree.length === 0) return;
    this.#redoStack = []; // a new edit forks history: the redo branch is gone
    const group = options?.group;
    const top = this.#undoStack[this.#undoStack.length - 1];
    const entry = top && group !== undefined && top.group === group ? top : newEntry(group);
    if (entry !== top) this.#undoStack.push(entry);
    this.#absorb(entry, changes);
    if (this.#undoStack.length > MAX_UNDO) this.#undoStack.shift();
  }

  /**
   * Fold changes into an undo step. Within one step, the FIRST "before" wins (that's what
   * the step started from) and the LATEST timestamp wins (that's the write now in effect).
   */
  #absorb(entry: UndoEntry, changes: ChangeSet): void {
    for (const change of changes.props) {
      const key = propKey(change.id, change.key);
      const existing = entry.props.get(key);
      entry.props.set(key, existing ? { ...existing, ts: change.ts } : change);
    }
    for (const change of changes.tree) {
      const existing = entry.tree.get(change.id);
      entry.tree.set(change.id, existing ? { ...existing, ts: change.ts } : change);
    }
  }

  /** Revert an undo step; returns the writes made and the step that would revert them back. */
  #revert(entry: UndoEntry): { result: UndoResult; inverse: UndoEntry | undefined } {
    const changes: ChangeSet = { props: [], tree: [] };
    const tree: MoveOp[] = [];
    const propsById = new Map<NodeId, Map<string, LWWMapEntry<PropValue>>>();
    const skipped = new Set<NodeId>();

    // Structure first: an undone delete must bring the node back before its props matter.
    for (const change of entry.tree.values()) {
      const inEffect = this.#tree.placedBy(change.id);
      if (!inEffect || compareTimestamps(inEffect, change.ts) !== 0) {
        skipped.add(change.id); // someone moved/deleted it after us: leave their change alone
        continue;
      }
      try {
        const before = this.#tree.get(change.id);
        const ops = change.before
          ? this.#tree.move(change.id, change.before.parent, change.before.position)
          : this.#tree.delete(change.id);
        for (const op of ops) {
          changes.tree.push({ id: change.id, ts: op.ts, before, beforeTs: inEffect });
          tree.push(op);
          if (change.beforeTs) this.#retarget("tree", change.id, change.beforeTs, op.ts);
        }
      } catch (error) {
        if (!(error instanceof TreeCycleError)) throw error;
        skipped.add(change.id); // the old parent now sits inside this node: can't go back there
      }
    }

    for (const change of entry.props.values()) {
      const map = this.#props.get(change.id);
      const current = map?.state.get(change.key);
      if (!map || !current || compareTimestamps(current.ts, change.ts) !== 0) {
        skipped.add(change.id); // someone wrote this property after us
        continue;
      }
      const before = current.deleted ? undefined : current.value;
      const written = change.before === undefined ? map.delete(change.key) : map.set(change.key, change.before);
      const out = propsById.get(change.id) ?? new Map<string, LWWMapEntry<PropValue>>();
      for (const [key, value] of written) {
        out.set(key, value);
        changes.props.push({ id: change.id, key, ts: value.ts, before, beforeTs: current.ts });
        if (change.beforeTs) this.#retarget("prop", propKey(change.id, key), change.beforeTs, value.ts);
      }
      propsById.set(change.id, out);
    }

    const inverse = newEntry(undefined);
    this.#absorb(inverse, changes);
    const empty = inverse.props.size === 0 && inverse.tree.size === 0;
    return {
      result: { delta: { tree, props: [...propsById] }, skipped: skipped.size },
      inverse: empty ? undefined : inverse,
    };
  }

  #propsOf(id: NodeId): LWWMap<PropValue> {
    let props = this.#props.get(id);
    if (!props) {
      props = new LWWMap<PropValue>(this.clock);
      this.#props.set(id, props);
    }
    return props;
  }

  #lastPosition(parent: NodeId): string | null {
    const children = this.#tree.children(parent);
    const last = children[children.length - 1];
    return last === undefined ? null : (this.#tree.get(last)?.position ?? null);
  }
}
