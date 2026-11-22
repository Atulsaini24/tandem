import type { NodeId, ShapeProps, ShapeView } from "@canvas/doc";
import type { PatchEvent } from "../engine/protocol";

interface Layer {
  readonly shapes: Map<NodeId, ShapeView>;
  order: NodeId[];
}

/**
 * The UI thread's view of the document: plain shape objects in render order.
 *
 * Local edits are applied here immediately (optimistic), stamped with the command's
 * seq. When the worker's patch for an older seq arrives after a newer local edit, the
 * patch would drag the shape back to a stale position — so per shape, any patch older
 * than the latest local edit is ignored. The newer edit's own patch confirms it.
 *
 * Preview mode (time travel): a second, read-only layer replaces what the renderer
 * sees. Live patches keep updating the live layer underneath, so leaving the preview
 * shows the current document instantly.
 *
 * The renderer consumes `dirty` / `orderDirty` once per frame, so N edits in one
 * frame cost one sprite update each, not N renders. `animate` asks it to tween the
 * next batch of changes instead of jumping (used when switching versions).
 */
export class Scene {
  readonly #live: Layer = { shapes: new Map(), order: [] };
  #preview: Layer | undefined;
  readonly #localSeq = new Map<NodeId, number>();
  readonly dirty = new Set<NodeId>();
  orderDirty = false;
  animate = false;

  get previewing(): boolean {
    return this.#preview !== undefined;
  }

  get size(): number {
    return this.#visible.shapes.size;
  }

  get(id: NodeId): ShapeView | undefined {
    return this.#visible.shapes.get(id);
  }

  ids(): readonly NodeId[] {
    return this.#visible.order;
  }

  /** Shapes back to front. */
  ordered(): ShapeView[] {
    const layer = this.#visible;
    const out: ShapeView[] = [];
    for (const id of layer.order) {
      const shape = layer.shapes.get(id);
      if (shape) out.push(shape);
    }
    return out;
  }

  /** Show a past version instead of the live document (null = back to live). Animated. */
  setPreview(shapes: readonly ShapeView[] | null): void {
    const before = this.#visible;
    this.#preview = shapes ? { shapes: new Map(shapes.map((s) => [s.id, s])), order: shapes.map((s) => s.id) } : undefined;
    const after = this.#visible;
    for (const id of before.shapes.keys()) if (before.shapes.get(id) !== after.shapes.get(id)) this.dirty.add(id);
    for (const id of after.shapes.keys()) if (before.shapes.get(id) !== after.shapes.get(id)) this.dirty.add(id);
    this.orderDirty = true;
    this.animate = true;
  }

  addLocal(shapes: readonly ShapeView[], seq: number): void {
    for (const shape of shapes) {
      if (!this.#live.shapes.has(shape.id)) {
        this.#live.order.push(shape.id);
        this.#markOrder();
      }
      this.#set(shape, seq);
    }
  }

  updateLocal(updates: ReadonlyArray<{ id: NodeId; patch: Partial<ShapeProps> }>, seq: number): void {
    for (const { id, patch } of updates) {
      const current = this.#live.shapes.get(id);
      if (current) this.#set({ ...current, ...patch }, seq);
    }
  }

  removeLocal(ids: readonly NodeId[]): void {
    const removed = new Set(ids);
    for (const id of ids) {
      this.#live.shapes.delete(id);
      this.#markDirty(id);
    }
    this.#live.order = this.#live.order.filter((id) => !removed.has(id));
    this.#markOrder();
  }

  applyPatch(patch: PatchEvent): void {
    const live = this.#live;
    for (const shape of patch.upserts) {
      if ((this.#localSeq.get(shape.id) ?? 0) > patch.seq) continue; // stale: a newer local edit is showing
      live.shapes.set(shape.id, shape);
      this.#markDirty(shape.id);
    }
    if (patch.removes.length > 0) {
      const removed = new Set(patch.removes);
      for (const id of removed) {
        live.shapes.delete(id);
        this.#markDirty(id);
      }
      live.order = live.order.filter((id) => !removed.has(id));
      this.#markOrder();
    }
    if (patch.order) {
      // A remote patch can carry an order computed before the worker saw our newest
      // optimistic creates. Keep those at the end until their own patch arrives.
      const inOrder = new Set(patch.order);
      const localOnly = live.order.filter(
        (id) => !inOrder.has(id) && live.shapes.has(id) && (this.#localSeq.get(id) ?? 0) > patch.seq,
      );
      live.order = [...patch.order, ...localOnly];
      this.#markOrder();
    }
  }

  get #visible(): Layer {
    return this.#preview ?? this.#live;
  }

  #set(shape: ShapeView, seq: number): void {
    this.#live.shapes.set(shape.id, shape);
    this.#localSeq.set(shape.id, seq);
    this.#markDirty(shape.id);
  }

  // While previewing, live changes aren't visible, so they don't need a redraw.
  #markDirty(id: NodeId): void {
    if (!this.#preview) this.dirty.add(id);
  }

  #markOrder(): void {
    if (!this.#preview) this.orderDirty = true;
  }
}
