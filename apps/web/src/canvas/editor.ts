import { MAX_LABEL_CHARS, type NodeId, type ShapeKind, type ShapeProps, type ShapeView } from "@canvas/doc";
import { AiRunner } from "./ai-runner";
import { EngineClient } from "../engine/engine-client";
import type { EngineEvent } from "../engine/protocol";
import { useUiStore, type BenchResult } from "../state/ui-store";
import { Controller } from "./controller";
import { loadIdentity } from "./identity";
import { Peers } from "./peers";
import { Renderer } from "./renderer";
import { Scene } from "./scene";
import type { Point } from "./viewport";

const PALETTE = [0x2f63ff, 0xef6b3a, 0x1e8f5a, 0x7b55e7, 0xdd4f78, 0x137d77, 0xc6513c, 0x111318];
const NOTE_FILL = 0xf2c94c;
const STATS_INTERVAL_MS = 500;
const FRAME_WINDOW = 120;
/** ~25 presence updates/s; receivers interpolate between them. */
const PRESENCE_INTERVAL_MS = 40;

const DOC_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Which server and document to sync with: ?doc=<id> picks the board, ?token=<t> signs in. */
function syncTarget(): { url: string; docId: string; token: string | undefined } {
  const params = new URLSearchParams(location.search);
  const requested = params.get("doc") ?? "default";
  const docId = DOC_ID_PATTERN.test(requested) ? requested : "default";
  const configured = import.meta.env.VITE_SYNC_URL as string | undefined;
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return { url: configured ?? `${scheme}://${location.hostname}:8787`, docId, token: params.get("token") ?? undefined };
}

/** The offline toggle is a per-viewer convenience: remembered across reloads. */
const offlineKey = (docId: string): string => `canvas:offline:${docId}`;
function readOffline(docId: string): boolean {
  try {
    return localStorage.getItem(offlineKey(docId)) === "1";
  } catch {
    return false;
  }
}
function writeOffline(docId: string, offline: boolean): void {
  try {
    if (offline) localStorage.setItem(offlineKey(docId), "1");
    else localStorage.removeItem(offlineKey(docId));
  } catch {
    // storage blocked: the toggle just won't survive a reload
  }
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
 *                                       → EngineClient → worker (CRDT, IndexedDB, network)
 *   worker patch → Scene.applyPatch → Renderer (once per frame)
 *   pointer/selection → presence (throttled) → worker → server → other tabs' Peers
 */
export class Editor {
  readonly scene = new Scene();
  readonly peers = new Peers();
  readonly engine = new EngineClient();
  readonly renderer: Renderer;
  readonly ai: AiRunner = new AiRunner(this);
  #controller: Controller | undefined;
  readonly #unsubscribe: Array<() => void> = [];
  #docId = "default";

  // Drag updates are coalesced: at most one engine command per frame. A timer backs up
  // the frame: background tabs get no animation frames, and an edit must never wait
  // for the screen to repaint before it reaches the engine (and the network).
  readonly #pendingMoves = new Map<NodeId, { x: number; y: number }>();
  #pendingSeq = 0;
  #flushTimer: ReturnType<typeof setTimeout> | undefined;
  readonly #onHidden = (): void => {
    if (document.visibilityState === "hidden") this.#flushMoves();
  };

  /** Each drag (or other gesture) gets a group id so it undoes as one step. */
  #nextGroup = 1;
  #pendingGroup: number | undefined;

  // Time travel: one history request in flight at a time; while dragging the slider,
  // only the latest position is fetched next (intermediate ones are skipped).
  #nextRequestId = 1;
  #historyInFlight: number | undefined;
  #historyQueued: number | undefined;

  readonly #me = loadIdentity();
  #pointer: Point | null = null;
  #presenceTimer: ReturnType<typeof setTimeout> | undefined;

  readonly #frameTimes: number[] = [];
  #statsElapsed = 0;
  #statsFrames = 0;
  #engineMs = 0;

  constructor() {
    this.renderer = new Renderer(this.scene, () => useUiStore.getState().selection, this.peers);
    this.#unsubscribe.push(this.engine.subscribe((event) => this.#onEngine(event)));
  }

  async init(host: HTMLElement): Promise<void> {
    await this.renderer.init(host);
    this.#controller = new Controller(this.renderer.app.canvas, this);
    this.renderer.frameListeners.add((dt) => this.#onFrame(dt));
    document.addEventListener("visibilitychange", this.#onHidden);
    useUiStore.getState().setMe(this.#me);
    this.#unsubscribe.push(
      useUiStore.subscribe((state, previous) => {
        if (state.selection !== previous.selection) this.#schedulePresence();
      }),
    );
  }

  /**
   * Open the document and start syncing. Separate from init() on purpose: under React
   * StrictMode two editors are created and one is thrown away. If both opened the
   * document, the throwaway's worker would lease the persisted replica first, and the
   * real editor would start a fresh one, stranding the last session's unsent edits.
   */
  connect(): void {
    const { url, docId, token } = syncTarget();
    this.#docId = docId;
    const online = !readOffline(docId);
    useUiStore.getState().setSync({ docId, wantOnline: online });
    this.engine.send(token ? { type: "connect", url, docId, online, token } : { type: "connect", url, docId, online });
    this.#schedulePresence();
  }

  /** The demo toggle: go offline / back online. Remembered across reloads. */
  setOnline(online: boolean): void {
    writeOffline(this.#docId, !online);
    useUiStore.getState().setSync({ wantOnline: online });
    this.engine.send({ type: "network", online });
    if (!online) {
      this.peers.clear(); // we can't see anyone while offline
      useUiStore.getState().setPeers([]);
    }
  }

  destroy(): void {
    // Only remove the debug hook if it's ours: under StrictMode a discarded editor
    // can finish tearing down after the surviving one has registered itself.
    if (Reflect.get(globalThis, "__editor") === this) Reflect.deleteProperty(globalThis, "__editor");
    document.removeEventListener("visibilitychange", this.#onHidden);
    this.ai.cancel();
    clearTimeout(this.#flushTimer);
    clearTimeout(this.#presenceTimer);
    this.#controller?.destroy();
    for (const unsubscribe of this.#unsubscribe) unsubscribe();
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

  /** Where this user's pointer is, in world coordinates (null = off the canvas). */
  updatePointer(world: Point | null): void {
    this.#pointer = world;
    this.#schedulePresence();
  }

  /** A yellow sticky note at `center`, opened for typing straight away. */
  createNote(center: Point): void {
    if (this.scene.previewing) return;
    const props: ShapeProps = { kind: "rect", x: center.x - 110, y: center.y - 42, w: 220, h: 84, fill: NOTE_FILL };
    const id = crypto.randomUUID();
    const seq = this.engine.nextSeq();
    this.scene.addLocal([{ id, ...props }], seq);
    this.engine.send({ type: "create", seq, shapes: [{ id, props }] });
    this.select([id]);
    useUiStore.getState().setTool("select");
    this.startEditing(id);
  }

  startEditing(id: NodeId): void {
    if (this.scene.previewing || !this.scene.get(id)) return;
    this.select([id]);
    useUiStore.getState().setEditing(id);
  }

  setLabel(id: NodeId, label: string): void {
    const current = this.scene.get(id);
    if (!current || (current.label ?? "") === label) return;
    const seq = this.engine.nextSeq();
    const patch = { label: Array.from(label).slice(0, MAX_LABEL_CHARS).join("") };
    this.scene.updateLocal([{ id, patch }], seq);
    this.engine.send({ type: "update", seq, updates: [{ id, patch }] });
  }

  /** AI: add a card, fading in (all cards of one AI run share `group`: one undo step). */
  aiCreate(props: ShapeProps, group: number): NodeId {
    const id = crypto.randomUUID();
    const seq = this.engine.nextSeq();
    this.scene.animate = true;
    this.scene.addLocal([{ id, ...props }], seq);
    this.engine.send({ type: "create", seq, shapes: [{ id, props }], group });
    return id;
  }

  /** AI: glide an existing shape into a slot. */
  aiMove(id: NodeId, rect: { x: number; y: number; w: number; h: number }, group: number): void {
    if (!this.scene.get(id)) return;
    const seq = this.engine.nextSeq();
    const patch = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    this.scene.animate = true;
    this.scene.updateLocal([{ id, patch }], seq);
    this.engine.send({ type: "update", seq, updates: [{ id, patch }], group });
  }

  fitTo(rect: { x: number; y: number; w: number; h: number }): void {
    // The AI panel (340px + margins) covers the right edge while open.
    this.renderer.fitTo(rect, 80, useUiStore.getState().aiOpen ? 372 : 0);
  }

  createShape(kind: ShapeKind, center: Point): void {
    if (this.scene.previewing) return;
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

  /** Start a gesture: every edit tagged with the returned group undoes as one step. */
  beginGroup(): number {
    this.#flushMoves(); // moves from a previous gesture must not join this one
    return this.#nextGroup++;
  }

  /** Move shapes now (optimistic) and queue the engine update for this frame. */
  moveLocal(moves: ReadonlyArray<{ id: NodeId; x: number; y: number }>, group?: number): void {
    if (this.scene.previewing) return;
    const seq = this.engine.nextSeq();
    this.scene.updateLocal(
      moves.map(({ id, x, y }) => ({ id, patch: { x, y } })),
      seq,
    );
    for (const { id, x, y } of moves) this.#pendingMoves.set(id, { x, y });
    this.#pendingSeq = seq;
    this.#pendingGroup = group;
    this.#flushTimer ??= setTimeout(() => this.#flushMoves(), 50);
  }

  undo(): void {
    if (this.scene.previewing) return;
    this.#flushMoves();
    this.engine.send({ type: "undo", seq: this.engine.nextSeq() });
  }

  redo(): void {
    if (this.scene.previewing) return;
    this.#flushMoves();
    this.engine.send({ type: "redo", seq: this.engine.nextSeq() });
  }

  // --- time travel ---------------------------------------------------------

  /** Open the history panel at the newest version. */
  openHistory(): void {
    if (useUiStore.getState().sync.status !== "online") {
      useUiStore.getState().setNotice("History needs a connection to the server");
      return;
    }
    this.#flushMoves();
    this.select([]);
    useUiStore.getState().setHistory({ at: Number.MAX_SAFE_INTEGER, head: 0, loading: true });
    this.#requestHistory(Number.MAX_SAFE_INTEGER);
  }

  /** Show the document as it was at server seq `at` (animated). */
  scrubHistory(at: number): void {
    const history = useUiStore.getState().history;
    if (!history) return;
    useUiStore.getState().setHistory({ ...history, at, loading: true });
    this.#requestHistory(at);
  }

  /** Make the live document match the previewed version (one undoable step), then go live. */
  restoreVersion(): void {
    const history = useUiStore.getState().history;
    if (!history || history.loading) return;
    this.engine.send({ type: "restore", seq: this.engine.nextSeq(), at: history.at });
    this.closeHistory();
    useUiStore.getState().setNotice(`Restored version ${history.at} — undo with ${navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl+"}Z`);
  }

  closeHistory(): void {
    this.#historyQueued = undefined;
    useUiStore.getState().setHistory(undefined);
    this.scene.setPreview(null);
  }

  #requestHistory(at: number): void {
    if (this.#historyInFlight !== undefined) {
      this.#historyQueued = at; // only the latest slider position matters
      return;
    }
    const requestId = this.#nextRequestId++;
    this.#historyInFlight = requestId;
    this.engine.send({ type: "history", requestId, at });
  }

  #onHistoryDone(): void {
    this.#historyInFlight = undefined;
    const queued = this.#historyQueued;
    this.#historyQueued = undefined;
    if (queued !== undefined && useUiStore.getState().history) this.#requestHistory(queued);
  }

  deleteSelection(): void {
    const ids = [...useUiStore.getState().selection];
    if (ids.length === 0 || this.scene.previewing) return;
    const seq = this.engine.nextSeq();
    this.scene.removeLocal(ids);
    this.engine.send({ type: "delete", seq, ids });
    this.select([]);
  }

  bringSelectionToFront(): void {
    const ids = [...useUiStore.getState().selection];
    if (ids.length > 0 && !this.scene.previewing) this.engine.send({ type: "front", seq: this.engine.nextSeq(), ids });
  }

  /** Scatter `count` random shapes around the view, then zoom out to show them. */
  spawn(count: number): void {
    if (this.scene.previewing) return;
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

  /** Send queued moves to the engine: on the next frame or after 50ms, whichever is first. */
  #flushMoves(): void {
    clearTimeout(this.#flushTimer);
    this.#flushTimer = undefined;
    if (this.#pendingMoves.size === 0) return;
    const updates = [...this.#pendingMoves].map(([id, patch]) => ({ id, patch }));
    this.#pendingMoves.clear();
    const group = this.#pendingGroup;
    this.engine.send(group === undefined ? { type: "update", seq: this.#pendingSeq, updates } : { type: "update", seq: this.#pendingSeq, updates, group });
  }

  #schedulePresence(): void {
    this.#presenceTimer ??= setTimeout(() => {
      this.#presenceTimer = undefined;
      this.engine.send({
        type: "presence",
        presence: {
          name: this.#me.name,
          color: this.#me.color,
          cursor: this.#pointer,
          selection: [...useUiStore.getState().selection].slice(0, 200),
        },
      });
    }, PRESENCE_INTERVAL_MS);
  }

  #onEngine(event: EngineEvent): void {
    const ui = useUiStore.getState();
    switch (event.type) {
      case "sync": {
        const { status, pending, error } = event;
        ui.setSync(error === undefined ? { status, pending } : { status, pending, error });
        if (status !== "online" && this.peers.list().length > 0) {
          this.peers.clear();
          ui.setPeers([]);
        }
        return;
      }
      case "error":
        console.error(`engine rejected command #${event.seq}: ${event.message}`);
        return;
      case "restored":
        if (!event.persistent) ui.setNotice("Offline storage unavailable: edits won't survive a reload");
        else if (event.pending > 0) {
          ui.setNotice(`Restored ${event.pending} unsynced edit${event.pending === 1 ? "" : "s"} from your last session`);
        } else if (event.resumed && event.shapes > 0) ui.setNotice(`Loaded ${event.shapes} shapes from this device`);
        return;
      case "undoState":
        ui.setUndo(event);
        if (event.skipped && event.skipped > 0) {
          const verb = event.action === "redo" ? "redone" : "undone";
          ui.setNotice(`${event.skipped} change${event.skipped === 1 ? " wasn't" : "s weren't"} ${verb}: someone else edited ${event.skipped === 1 ? "it" : "them"} since`);
        }
        return;
      case "history": {
        this.#onHistoryDone();
        const history = ui.history;
        if (!history) return; // closed while loading
        ui.setHistory({ at: event.at, head: event.head, loading: this.#historyInFlight !== undefined });
        this.scene.setPreview(event.shapes);
        return;
      }
      case "historyError":
        this.#onHistoryDone();
        if (ui.history) ui.setHistory({ ...ui.history, loading: false, error: event.message });
        return;
      case "presence":
        if (this.peers.update(event.clientId, event.presence)) {
          ui.setPeers(this.peers.list().map((p) => ({ clientId: p.clientId, name: p.presence.name, color: p.presence.color })));
        }
        return;
      case "patch":
        this.scene.applyPatch(event);
        this.#engineMs = event.engineMs;
        if (event.removes.length > 0 && event.removes.some((id) => ui.selection.has(id))) {
          this.select([...ui.selection].filter((id) => this.scene.get(id)));
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
    instance.connect(); // only the editor that survives opens the document
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
