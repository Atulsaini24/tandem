import type { NodeId, ShapeProps, ShapeView } from "@canvas/doc";
import type { PatchEvent } from "../engine/protocol";

/**
 * The UI thread's view of the document: plain shape objects in render order.
 *
 * Local edits are applied here immediately (optimistic), stamped with the command's
 * seq. When the worker's patch for an older seq arrives after a newer local edit, the
 * patch would drag the shape back to a stale position — so per shape, any patch older
 * than the latest local edit is ignored. The newer edit's own patch confirms it.
 *
 * The renderer consumes `dirty` / `orderDirty` once per frame, so N edits in one
 * frame cost one sprite update each, not N renders.
 */
export class Scene {
  readonly #shapes = new Map<NodeId, ShapeView>();
  readonly #localSeq = new Map<NodeId, number>();
  #order: NodeId[] = [];
  readonly dirty = new Set<NodeId>();
  orderDirty = false;

  get size(): number {
    return this.#shapes.size;
  }

  get(id: NodeId): ShapeView | undefined {
    return this.#shapes.get(id);
  }

  ids(): readonly NodeId[] {
    return this.#order;
  }

  /** Shapes back to front. */
  ordered(): ShapeView[] {
    const out: ShapeView[] = [];
    for (const id of this.#order) {
      const shape = this.#shapes.get(id);
      if (shape) out.push(shape);
    }
    return out;
  }

  addLocal(shapes: readonly ShapeView[], seq: number): void {
    for (const shape of shapes) {
      if (!this.#shapes.has(shape.id)) {
        this.#order.push(shape.id);
        this.orderDirty = true;
      }
      this.#set(shape, seq);
    }
  }

  updateLocal(updates: ReadonlyArray<{ id: NodeId; patch: Partial<ShapeProps> }>, seq: number): void {
    for (const { id, patch } of updates) {
      const current = this.#shapes.get(id);
      if (current) this.#set({ ...current, ...patch }, seq);
    }
  }

  removeLocal(ids: readonly NodeId[]): void {
    const removed = new Set(ids);
    for (const id of ids) {
      this.#shapes.delete(id);
      this.dirty.add(id);
    }
    this.#order = this.#order.filter((id) => !removed.has(id));
    this.orderDirty = true;
  }

  applyPatch(patch: PatchEvent): void {
    for (const shape of patch.upserts) {
      if ((this.#localSeq.get(shape.id) ?? 0) > patch.seq) continue; // stale: a newer local edit is showing
      this.#shapes.set(shape.id, shape);
      this.dirty.add(shape.id);
    }
    if (patch.removes.length > 0) {
      const removed = new Set(patch.removes);
      for (const id of removed) {
        this.#shapes.delete(id);
        this.dirty.add(id);
      }
      this.#order = this.#order.filter((id) => !removed.has(id));
      this.orderDirty = true;
    }
    if (patch.order) {
      this.#order = [...patch.order];
      this.orderDirty = true;
    }
  }

  #set(shape: ShapeView, seq: number): void {
    this.#shapes.set(shape.id, shape);
    this.#localSeq.set(shape.id, seq);
    this.dirty.add(shape.id);
  }
}
