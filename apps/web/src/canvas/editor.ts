import type { NodeId, ShapeKind, ShapeProps, ShapeView } from "@canvas/doc";
import { EngineClient } from "../engine/engine-client";
import type { EngineEvent } from "../engine/protocol";
import { useUiStore, type BenchResult } from "../state/ui-store";
import { Controller } from "./controller";
import { Renderer } from "./renderer";
import { Scene } from "./scene";
import type { Point } from "./viewport";

const PALETTE = [0x2f63ff, 0xef6b3a, 0x1e8f5a, 0x7b55e7, 0xdd4f78, 0x137d77, 0xc6513c, 0x111318];
const STATS_INTERVAL_MS = 500;
const FRAME_WINDOW = 120;

const DOC_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Which server and document to sync with: ?doc=<id> picks the board. */
function syncTarget(): { url: string; docId: string } {
  const requested = new URLSearchParams(location.search).get("doc") ?? "default";
  const docId = DOC_ID_PATTERN.test(requested) ? requested : "default";
  const configured = import.meta.env.VITE_SYNC_URL as string | undefined;
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return { url: configured ?? `${scheme}://${location.hostname}:8787`, docId };
}

function randomFill(): number {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)] ?? 0x111318;
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}

/**
 * Wires the pieces together:
 *
 *   input (Controller) → Editor actions → Scene (optimistic, instant)
 *                                       → EngineClient → worker (CRDT, truth)
 *   worker patch → Scene.applyPatch → Renderer (once per frame)
 */
export class Editor {
  readonly scene = new Scene();
  readonly engine = new EngineClient();
  readonly renderer: Renderer;
  #controller: Controller | undefined;
  readonly #unsubscribe: () => void;

  // Drag updates are coalesced: at most one engine command per frame. A timer backs up
  // the frame: background tabs get no animation frames, and an edit must never wait
  // for the screen to repaint before it reaches the engine (and the network).
  readonly #pendingMoves = new Map<NodeId, { x: number; y: number }>();
  #pendingSeq = 0;
  #flushTimer: ReturnType<typeof setTimeout> | undefined;
  readonly #onHidden = (): void => {
    if (document.visibilityState === "hidden") this.#flushMoves();
  };

  readonly #frameTimes: number[] = [];
  #statsElapsed = 0;
  #statsFrames = 0;
  #engineMs = 0;

  constructor() {
    this.renderer = new Renderer(this.scene, () => useUiStore.getState().selection);
    this.#unsubscribe = this.engine.subscribe((event) => this.#onEngine(event));
  }

  async init(host: HTMLElement): Promise<void> {
    await this.renderer.init(host);
    this.#controller = new Controller(this.renderer.app.canvas, this);
    this.renderer.frameListeners.add((dt) => this.#onFrame(dt));
    document.addEventListener("visibilitychange", this.#onHidden);

    const { url, docId } = syncTarget();
    useUiStore.getState().setSync({ docId });
    this.engine.send({ type: "connect", url, docId });
  }

  /** The demo toggle: simulate losing / regaining the network. */
  setOnline(online: boolean): void {
    useUiStore.getState().setSync({ wantOnline: online });
    this.engine.send({ type: "network", online });
  }

  destroy(): void {
    // Only remove the debug hook if it's ours: under StrictMode a discarded editor
    // can finish tearing down after the surviving one has registered itself.
    if (Reflect.get(globalThis, "__editor") === this) Reflect.deleteProperty(globalThis, "__editor");
    document.removeEventListener("visibilitychange", this.#onHidden);
    clearTimeout(this.#flushTimer);
    this.#controller?.destroy();
    this.#unsubscribe();
    this.engine.terminate();
    this.renderer.destroy();
  }

  // --- actions -------------------------------------------------------------

  select(ids: Iterable<NodeId>): void {
    useUiStore.getState().setSelection(new Set(ids));
  }

  selectAll(): void {
    this.select(this.scene.ids());
  }

  createShape(kind: ShapeKind, center: Point): void {
    const w = kind === "rect" ? 160 : 120;
    const h = kind === "rect" ? 100 : 120;
    const props: ShapeProps = { kind, x: center.x - w / 2, y: center.y - h / 2, w, h, fill: randomFill() };
    const id = crypto.randomUUID();
    const seq = this.engine.nextSeq();
    this.scene.addLocal([{ id, ...props }], seq);
    this.engine.send({ type: "create", seq, shapes: [{ id, props }] });
    this.select([id]);
    useUiStore.getState().setTool("select");
  }

  /** Move shapes now (optimistic) and queue the engine update for this frame. */
  moveLocal(moves: ReadonlyArray<{ id: NodeId; x: number; y: number }>): void {
    const seq = this.engine.nextSeq();
    this.scene.updateLocal(
      moves.map(({ id, x, y }) => ({ id, patch: { x, y } })),
      seq,
    );
    for (const { id, x, y } of moves) this.#pendingMoves.set(id, { x, y });
    this.#pendingSeq = seq;
    this.#flushTimer ??= setTimeout(() => this.#flushMoves(), 50);
  }

  /** Send queued moves to the engine: on the next frame or after 50ms, whichever is first. */
  #flushMoves(): void {
    clearTimeout(this.#flushTimer);
    this.#flushTimer = undefined;
    if (this.#pendingMoves.size === 0) return;
    const updates = [...this.#pendingMoves].map(([id, patch]) => ({ id, patch }));
    this.#pendingMoves.clear();
    this.engine.send({ type: "update", seq: this.#pendingSeq, updates });
  }

  deleteSelection(): void {
    const ids = [...useUiStore.getState().selection];
    if (ids.length === 0) return;
    const seq = this.engine.nextSeq();
    this.scene.removeLocal(ids);
    this.engine.send({ type: "delete", seq, ids });
    this.select([]);
  }

  bringSelectionToFront(): void {
    const ids = [...useUiStore.getState().selection];
    if (ids.length > 0) this.engine.send({ type: "front", seq: this.engine.nextSeq(), ids });
  }

  /** Scatter `count` random shapes around the view, then zoom out to show them. */
  spawn(count: number): void {
    const { width, height } = this.renderer.screen;
    const center = this.renderer.screenToWorld({ x: width / 2, y: height / 2 });
    const zoom = this.renderer.viewport.zoom;
    const spreadX = (width / zoom) * 3;
    const spreadY = (height / zoom) * 3;
    const shapes = Array.from({ length: count }, () => {
      const kind: ShapeKind = Math.random() < 0.6 ? "rect" : "ellipse";
      const w = 24 + Math.random() * 72;
      const h = kind === "ellipse" && Math.random() < 0.5 ? w : 24 + Math.random() * 72;
      return {
        id: crypto.randomUUID(),
        props: {
          kind,
          x: center.x + (Math.random() - 0.5) * spreadX,
          y: center.y + (Math.random() - 0.5) * spreadY,
          w,
          h,
          fill: randomFill(),
        },
      };
    });
    this.engine.send({ type: "create", seq: this.engine.nextSeq(), shapes });
    this.renderer.setZoomTarget(zoom / 3, { x: width / 2, y: height / 2 });
  }

  /**
   * The M4 gate, measured: for `durationMs`, drag up to 500 shapes along a circle
   * through the real path (Scene + engine worker), while panning and zooming.
   */
  benchmark(durationMs = 5_000): Promise<BenchResult> {
    const movers = this.scene.ordered().slice(0, 500);
    const { width, height } = this.renderer.screen;
    const anchor = { x: width / 2, y: height / 2 };
    const baseZoom = this.renderer.viewport.zoom;
    const frames: number[] = [];
    const work: number[] = [];
    let elapsed = 0;
    let frameStart = 0;
    // Bracket the whole frame: first ticker callback → after Pixi's render (priority -25).
    const ticker = this.renderer.app.ticker;
    const begin = (): void => {
      frameStart = performance.now();
    };
    const end = (): void => {
      if (frameStart > 0) work.push(performance.now() - frameStart);
    };
    ticker.add(begin, undefined, 1000);
    ticker.add(end, undefined, -1000);
    useUiStore.getState().setBench("running");

    return new Promise((resolve) => {
      const tick = (dt: number): void => {
        elapsed += dt;
        frames.push(dt);
        const t = elapsed / 1000;
        this.moveLocal(
          movers.map((s: ShapeView) => ({ id: s.id, x: s.x + Math.cos(t * 3) * 80, y: s.y + Math.sin(t * 3) * 80 })),
        );
        this.renderer.panBy(Math.cos(t * 0.8) * 1.5, Math.sin(t * 0.8) * 1.5);
        this.renderer.setZoomTarget(baseZoom * (1 + 0.6 * Math.sin(t * 1.4)), anchor);
        if (elapsed < durationMs) return;

        this.renderer.frameListeners.delete(tick);
        ticker.remove(begin);
        ticker.remove(end);
        this.renderer.setZoomTarget(baseZoom, anchor);
        const measured = frames.slice(10); // skip warm-up frames
        const measuredWork = work.slice(10);
        const mean = measured.reduce((sum, d) => sum + d, 0) / Math.max(1, measured.length);
        const result: BenchResult = {
          workMedianMs: Math.round(percentile(measuredWork, 0.5) * 100) / 100,
          workP95Ms: Math.round(percentile(measuredWork, 0.95) * 100) / 100,
          frames: measured.length,
          avgFps: Math.round((1000 / mean) * 10) / 10,
          p95FrameMs: Math.round(percentile(measured, 0.95) * 10) / 10,
          worstFrameMs: Math.round(Math.max(...measured) * 10) / 10,
          slowFrames: measured.filter((d) => d > 20).length,
          shapes: this.scene.size,
          movedPerFrame: movers.length,
        };
        useUiStore.getState().setBench(result);
        resolve(result);
      };
      this.renderer.frameListeners.add(tick);
    });
  }

  // --- internals -----------------------------------------------------------

  #onEngine(event: EngineEvent): void {
    if (event.type === "sync") {
      const { status, pending, error } = event;
      useUiStore.getState().setSync(error === undefined ? { status, pending } : { status, pending, error });
      return;
    }
    if (event.type === "error") {
      console.error(`engine rejected command #${event.seq}: ${event.message}`);
      return;
    }
    this.scene.applyPatch(event);
    this.#engineMs = event.engineMs;
    if (event.removes.length > 0) {
      const selection = useUiStore.getState().selection;
      if (event.removes.some((id) => selection.has(id))) {
        this.select([...selection].filter((id) => this.scene.get(id)));
      }
    }
  }

  #onFrame(dtMs: number): void {
    this.#flushMoves();

    this.#frameTimes.push(dtMs);
    if (this.#frameTimes.length > FRAME_WINDOW) this.#frameTimes.shift();
    this.#statsElapsed += dtMs;
    this.#statsFrames += 1;
    if (this.#statsElapsed >= STATS_INTERVAL_MS) {
      useUiStore.getState().setStats({
        fps: Math.round((this.#statsFrames * 1000) / this.#statsElapsed),
        p95: Math.round(percentile(this.#frameTimes, 0.95) * 10) / 10,
        shapes: this.scene.size,
        zoom: this.renderer.viewport.zoom,
        engineMs: Math.round(this.#engineMs * 10) / 10,
      });
      this.#statsElapsed = 0;
      this.#statsFrames = 0;
    }
  }
}

/** Create an editor; safe under React StrictMode's mount → unmount → mount. */
export function createEditor(host: HTMLElement): { ready: Promise<Editor | null>; destroy(): void } {
  let destroyed = false;
  let editor: Editor | undefined;
  const ready = (async () => {
    const instance = new Editor();
    try {
      await instance.init(host);
    } catch (error) {
      console.error("canvas failed to start", error);
      instance.destroy();
      return null;
    }
    if (destroyed) {
      instance.destroy();
      return null;
    }
    editor = instance;
    // Debug/benchmark hook for the console and automated tests (surviving editor only).
    Object.assign(globalThis, { __editor: instance });
    return instance;
  })();
  return {
    ready,
    destroy: () => {
      destroyed = true;
      editor?.destroy();
    },
  };
}
