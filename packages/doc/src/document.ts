import {
  HybridLogicalClock,
  LWWMap,
  MoveTree,
  ROOT,
  positionsBetween,
  type LWWMapEntry,
  type LWWMapState,
  type MoveOp,
  type NodeId,
  type PhysicalClock,
  type ReplicaId,
  type TreeDelta,
} from "@canvas/crdt";

/**
 * The canvas document: a composition of CRDTs.
 *
 *   structure  → one MoveTree (parent + z-order of every shape)
 *   properties → one LWWMap per shape (kind, x, y, w, h, fill)
 *
 * They share one HLC, so timestamps across both are comparable. Moving a shape and
 * recoloring it concurrently touch different CRDTs and can never conflict.
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

const PROP_KEYS = ["kind", "x", "y", "w", "h", "fill"] as const satisfies ReadonlyArray<keyof ShapeProps>;

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
  return { id, kind, x, y, w, h, fill };
}

export class CanvasDocument {
  readonly clock: HybridLogicalClock;
  readonly #tree: MoveTree;
  readonly #props = new Map<NodeId, LWWMap<PropValue>>();

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

  /** Add shapes on top of everything else, in the given order. */
  createShapes(shapes: ReadonlyArray<{ readonly id: NodeId; readonly props: ShapeProps }>): DocDelta {
    for (const shape of shapes) {
      validatePatch(shape.props);
      if (this.#tree.get(shape.id) || this.#props.has(shape.id)) {
        throw new RangeError(`shape "${shape.id}" already exists`);
      }
    }
    const positions = positionsBetween(this.#lastPosition(ROOT), null, shapes.length);
    const tree: MoveOp[] = [];
    const props: Array<readonly [NodeId, LWWMapState<PropValue>]> = [];
    shapes.forEach((shape, i) => {
      const position = positions[i];
      if (position === undefined) throw new Error("position generation mismatch");
      props.push([shape.id, this.#write(shape.id, shape.props)]);
      tree.push(...this.#tree.move(shape.id, ROOT, position));
    });
    return { tree, props };
  }

  /** Change properties. Unknown ids are skipped (they may have been deleted remotely). */
  updateShapes(updates: ReadonlyArray<{ readonly id: NodeId; readonly patch: Partial<ShapeProps> }>): DocDelta {
    const props: Array<readonly [NodeId, LWWMapState<PropValue>]> = [];
    for (const { id, patch } of updates) {
      validatePatch(patch);
      if (!this.#props.has(id)) continue;
      props.push([id, this.#write(id, patch)]);
    }
    return { tree: [], props };
  }

  deleteShapes(ids: Iterable<NodeId>): DocDelta {
    const tree: MoveOp[] = [];
    for (const id of ids) if (this.#tree.isAttached(id)) tree.push(...this.#tree.delete(id));
    return { tree, props: [] };
  }

  /** Move shapes above everything else, keeping their relative order. */
  bringToFront(ids: Iterable<NodeId>): DocDelta {
    const wanted = new Set(ids);
    const ordered = this.#tree.children(ROOT).filter((id) => wanted.has(id));
    const positions = positionsBetween(this.#lastPosition(ROOT), null, ordered.length);
    const tree: MoveOp[] = [];
    ordered.forEach((id, i) => {
      const position = positions[i];
      if (position !== undefined) tree.push(...this.#tree.move(id, ROOT, position));
    });
    return { tree, props: [] };
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

  #write(id: NodeId, patch: Partial<ShapeProps>): LWWMapState<PropValue> {
    const props = this.#propsOf(id);
    const delta = new Map<string, LWWMapEntry<PropValue>>();
    for (const key of PROP_KEYS) {
      const value = patch[key];
      if (value === undefined) continue;
      for (const [k, entry] of props.set(key, value)) delta.set(k, entry);
    }
    return delta;
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
