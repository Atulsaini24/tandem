import { MAX_LABEL_CHARS, formatPoints, type NodeId, type ShapeKind, type ShapeProps, type ShapeView } from "@canvas/doc";
import { upsertBoard } from "../boards";
import { EngineClient } from "../engine/engine-client";
import type { EngineEvent } from "../engine/protocol";
import { useUiStore, type BenchResult } from "../state/ui-store";
import { AiRunner } from "./ai-runner";
import { Controller } from "./controller";
import { CrowdSim } from "./crowd";
import { download, safeFilename, svgToPng, toSvg } from "./export";
import { arrowBox, boundsOf, boundsOfPoints, center, containsRect, intersects, visualBounds, type Rect } from "./geometry";
import { loadIdentity } from "./identity";
import { Peers } from "./peers";
import { Renderer } from "./renderer";
import { Scene } from "./scene";
import { applyPendingMerge, seedBranch } from "./branch";
import { templateById, type TemplateId, TEMPLATES, INK, NOTE_COLORS } from "./templates";
import { CANVAS_THEMES } from "./theme";
import type { Point } from "./viewport";

export const PALETTE = [0x2f63ff, 0xef6b3a, 0x1e8f5a, 0x7b55e7, 0xdd4f78, 0x137d77, 0xc98a12, 0x111318] as const;
export const NOTE_FILL = NOTE_COLORS.yellow;
const STATS_INTERVAL_MS = 500;
const FRAME_WINDOW = 120;
/** ~25 presence updates/s; receivers interpolate between them. */
const PRESENCE_INTERVAL_MS = 40;
const REGISTRY_INTERVAL_MS = 2_000;
const CLIPBOARD_TAG = "canvas/shapes@1";
export const VOTES_PER_PERSON = 5;

export interface BoardTarget {
  readonly docId: string;
  readonly token?: string | undefined;
  /** Opened from a view-only share link. */
  readonly viewMode?: boolean;
  /** Fill a brand-new (empty) board from this template. */
  readonly template?: string | undefined;
}

function syncUrl(): string {
  const configured = import.meta.env.VITE_SYNC_URL as string | undefined;
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return configured ?? `${scheme}://${location.hostname}:8787`;
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
  return PALETTE[Math.floor(Math.random() * (PALETTE.length - 1))] ?? 0x2f63ff;
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}

type Patch = Partial<ShapeProps>;
export type Align = "left" | "center" | "right" | "top" | "middle" | "bottom";

/**
 * Wires the pieces together:
 *
 *   input (Controller) → Editor actions → Scene (optimistic, instant)
 *                                       → EngineClient → worker (CRDT, IndexedDB, network)
 *   worker patch → Scene.applyPatch → Renderer (once per frame)
 *   pointer/selection/view → presence (throttled) → worker → server → other tabs' Peers
 */
export class Editor {
  readonly scene = new Scene();
  readonly peers = new Peers();
  readonly engine = new EngineClient();
  readonly renderer: Renderer;
  readonly ai: AiRunner = new AiRunner(this);
  #controller: Controller | undefined;
  readonly #unsubscribe: Array<() => void> = [];
  readonly #target: BoardTarget;

  // Drag updates are coalesced: at most one engine command per frame. A timer backs up
  // the frame: background tabs get no animation frames, and an edit must never wait
  // for the screen to repaint before it reaches the engine (and the network).
  readonly #pending = new Map<NodeId, Patch>();
  #pendingSeq = 0;
  #pendingGroup: number | undefined;
  #flushTimer: ReturnType<typeof setTimeout> | undefined;
  readonly #onHidden = (): void => {
    if (document.visibilityState === "hidden") this.#flush();
  };

  /** Each drag (or other gesture) gets a group id so it undoes as one step. */
  #nextGroup = 1;

  // Time travel: one history request in flight at a time; while dragging the slider,
  // only the latest position is fetched next (intermediate ones are skipped).
  #nextRequestId = 1;
  #historyInFlight: number | undefined;
  #historyQueued: number | undefined;

  readonly #me = loadIdentity();
  #pointer: Point | null = null;
  #presenceTimer: ReturnType<typeof setTimeout> | undefined;
  #lastView = "";
  #reaction: { emoji: string; n: number } | undefined;
  readonly #seenReactions = new Map<string, number>();

  #clipboard: { shapes: ShapeView[]; pastes: number } | undefined;
  #crowd: CrowdSim | undefined;
  #revealTimer: ReturnType<typeof setTimeout> | undefined;
  #registryTimer: ReturnType<typeof setTimeout> | undefined;
  #restored = false;

  readonly #frameTimes: number[] = [];
  #statsElapsed = 0;
  #statsFrames = 0;
  #engineMs = 0;

  constructor(target: BoardTarget) {
    this.#target = target;
    this.renderer = new Renderer(this.scene, () => useUiStore.getState().selection, this.peers);
    this.#unsubscribe.push(this.engine.subscribe((event) => this.#onEngine(event)));
  }

  get docId(): string {
    return this.#target.docId;
  }

  async init(host: HTMLElement): Promise<void> {
    await this.renderer.init(host, CANVAS_THEMES[useUiStore.getState().theme]);
    this.#unsubscribe.push(
      useUiStore.subscribe((state, previous) => {
        if (state.theme !== previous.theme) this.renderer.setTheme(CANVAS_THEMES[state.theme]);
        if (state.selection !== previous.selection) this.#schedulePresence();
        if (state.editing !== previous.editing) this.renderer.hiddenLabel = state.editing;
        if (state.chat !== previous.chat) this.#schedulePresence();
      }),
    );
    this.renderer.voter = this.#me.id;
    this.#controller = new Controller(this.renderer.app.canvas, this);
    this.renderer.frameListeners.add((dt) => this.#onFrame(dt));
    document.addEventListener("visibilitychange", this.#onHidden);
    useUiStore.getState().setMe(this.#me);
  }

  /**
   * Open the document and start syncing. Separate from init() on purpose: under React
   * StrictMode two editors are created and one is thrown away. If both opened the
   * document, the throwaway's worker would lease the persisted replica first, and the
   * real editor would start a fresh one, stranding the last session's unsent edits.
   */
  connect(): void {
    const { docId, token } = this.#target;
    const online = !readOffline(docId);
    const ui = useUiStore.getState();
    ui.setSync({ docId, wantOnline: online, readOnly: false, status: "offline", pending: 0 });
    ui.setViewMode(this.#target.viewMode === true);
    ui.setTitle(undefined);
    ui.setSelection(new Set());
    const url = syncUrl();
    this.engine.send(token ? { type: "connect", url, docId, online, token } : { type: "connect", url, docId, online });
    this.#schedulePresence();
  }

  /** The demo toggle: go offline / back online. Remembered across reloads. */
  setOnline(online: boolean): void {
    writeOffline(this.docId, !online);
    useUiStore.getState().setSync({ wantOnline: online });
    this.engine.send({ type: "network", online });
    if (!online) {
      this.peers.clear(); // we can't see anyone while offline
      useUiStore.getState().setPeers([]);
      useUiStore.getState().setFollowing(undefined);
    }
  }

  destroy(): void {
    // Only remove the debug hook if it's ours: under StrictMode a discarded editor
    // can finish tearing down after the surviving one has registered itself.
    if (Reflect.get(globalThis, "__editor") === this) Reflect.deleteProperty(globalThis, "__editor");
    document.removeEventListener("visibilitychange", this.#onHidden);
    this.#flush();
    this.#saveRegistry();
    this.ai.cancel();
    this.#crowd?.stop();
    clearTimeout(this.#flushTimer);
    clearTimeout(this.#presenceTimer);
    clearTimeout(this.#registryTimer);
    this.#controller?.destroy();
    for (const unsubscribe of this.#unsubscribe) unsubscribe();
    this.engine.terminate();
    this.renderer.destroy();
    const ui = useUiStore.getState();
    ui.setPeers([]);
    ui.setFollowing(undefined);
    ui.setEditing(undefined);
    ui.setHistory(undefined);
  }

  // --- state ----------------------------------------------------------------

  /**
   * Editing is off while a past version is on screen (time travel), when the server said
   * this client is a viewer, or in a tab opened from a view-only link. Every edit path
   * checks this one flag.
   */
  get locked(): boolean {
    const ui = useUiStore.getState();
    return this.scene.previewing || ui.sync.readOnly || ui.viewMode;
  }

  readonly lookup = (id: NodeId): ShapeView | undefined => this.scene.get(id);

  selected(): ShapeView[] {
    return [...useUiStore.getState().selection].flatMap((id) => {
      const s = this.scene.get(id);
      return s ? [s] : [];
    });
  }

  select(ids: Iterable<NodeId>): void {
    useUiStore.getState().setSelection(new Set(ids));
  }

  selectAll(): void {
    this.select(this.scene.ids());
  }

  /** Where this user's pointer is, in world coordinates (null = off the canvas). */
  updatePointer(world: Point | null): void {
    this.#pointer = world;
    if (world && useUiStore.getState().laser) this.renderer.addLaserPoint("me", world, this.#me.color);
    this.#schedulePresence();
  }

  get pointer(): Point | null {
    return this.#pointer;
  }

  /** The center of the visible area (where keyboard-created things appear). */
  viewCenter(): Point {
    const { width, height } = this.renderer.screen;
    return this.renderer.screenToWorld({ x: width / 2, y: height / 2 });
  }

  // --- creating ---------------------------------------------------------------

  /** Create shapes optimistically; returns their ids. One undo step per call (or `group`). */
  /** Create shapes with the given ids (branches and merges keep ids so changes line up). */
  createWithIds(shapes: ReadonlyArray<{ id: NodeId; props: ShapeProps }>, group?: number): NodeId[] {
    return this.#create(shapes, group, true);
  }

  #create(shapes: ReadonlyArray<{ id?: NodeId; props: ShapeProps }>, group?: number, animate = false): NodeId[] {
    if (this.locked || shapes.length === 0) return [];
    this.#flush();
    const withIds = shapes.map((s) => ({ id: s.id ?? crypto.randomUUID(), props: s.props }));
    const seq = this.engine.nextSeq();
    if (animate) this.scene.animate = true;
    this.scene.addLocal(
      withIds.map((s) => ({ id: s.id, ...s.props })),
      seq,
    );
    this.engine.send(group === undefined ? { type: "create", seq, shapes: withIds } : { type: "create", seq, shapes: withIds, group });
    return withIds.map((s) => s.id);
  }

  /** A shape of `kind` filling `rect` (drawn with the tool), or a default size at a point. */
  createBox(kind: "rect" | "ellipse" | "diamond" | "frame", rect: Rect | Point): NodeId | undefined {
    const sizes = { rect: [180, 110], ellipse: [140, 140], diamond: [170, 130], frame: [640, 420] } as const;
    const [dw, dh] = sizes[kind];
    const r: Rect = "w" in rect && rect.w >= 8 && rect.h >= 8 ? rect : { x: rect.x - dw / 2, y: rect.y - dh / 2, w: dw, h: dh };
    const fill = kind === "frame" ? 0x7b55e7 : useUiStore.getState().fill;
    const props: ShapeProps = kind === "frame" ? { kind, ...r, fill, label: "Frame" } : { kind, ...r, fill };
    const group = this.beginGroup();
    const [id] = this.#create([{ props }], group);
    if (!id) return undefined;
    if (kind === "frame") {
      // Frames sit behind what's inside them; adopt anything already within the rectangle.
      this.engine.send({ type: "back", seq: this.engine.nextSeq(), ids: [id], group });
    }
    this.select([id]);
    useUiStore.getState().setTool("select");
    return id;
  }

  /** Kept for the AI runner, tests and the keyboard. */
  createShape(kind: ShapeKind, center: Point): void {
    if (kind === "rect" || kind === "ellipse" || kind === "diamond" || kind === "frame") this.createBox(kind, center);
  }

  /** A sticky note at `at`, opened for typing straight away. */
  createNote(at: Point, fill: number = NOTE_FILL): void {
    const [id] = this.#create([{ props: { kind: "rect", x: at.x - 110, y: at.y - 50, w: 220, h: 100, fill, label: " " } }]);
    if (!id) return;
    this.select([id]);
    useUiStore.getState().setTool("select");
    this.startEditing(id);
  }

  createText(at: Point): void {
    const [id] = this.#create([{ props: { kind: "text", x: at.x, y: at.y - 18, w: 320, h: 40, fill: INK, label: " " } }]);
    if (!id) return;
    this.select([id]);
    useUiStore.getState().setTool("select");
    this.startEditing(id);
  }

  createComment(at: Point): void {
    const [id] = this.#create([{ props: { kind: "comment", x: at.x - 4, y: at.y - 32, w: 32, h: 32, fill: this.#me.color, author: this.#me.name, label: " " } }]);
    if (!id) return;
    this.select([id]);
    useUiStore.getState().setTool("select");
    this.startEditing(id);
  }

  createArrow(a: Point, b: Point, from?: NodeId, to?: NodeId): NodeId | undefined {
    const box = arrowBox(a, b);
    const props: ShapeProps = { kind: "arrow", ...box, fill: INK, ...(from ? { from } : {}), ...(to ? { to } : {}) };
    const [id] = this.#create([{ props }]);
    if (id) this.select([id]);
    return id;
  }

  /** A pen stroke from world points (simplified). */
  createPath(points: readonly Point[]): NodeId | undefined {
    const simple = simplify(points, 0.8);
    const bounds = boundsOfPoints(simple);
    if (!bounds || simple.length < 2) return undefined;
    const w = Math.max(1, bounds.w);
    const h = Math.max(1, bounds.h);
    const normalized = simple.map((p) => ({ x: (p.x - bounds.x) / w, y: (p.y - bounds.y) / h }));
    const [id] = this.#create([{ props: { kind: "path", x: bounds.x, y: bounds.y, w, h, fill: useUiStore.getState().fill, points: formatPoints(normalized) } }]);
    return id;
  }

  startEditing(id: NodeId): void {
    const shape = this.scene.get(id);
    if (this.locked || !shape || shape.kind === "path") return;
    if (shape.kind === "scene3d") {
      useUiStore.getState().setOrbiting(id);
      return;
    }
    if (shape.kind === "slide") {
      // Slides: edit the text right where it is (Studio is a click away).
      this.select([id]);
      useUiStore.getState().setSlideEdit(id);
      return;
    }
    if (shape.kind === "chart") {
      this.select([id]);
      useUiStore.getState().setStudio(id);
      return;
    }
    if (shape.kind === "embed") {
      // A page goes live (clickable); a code block opens for editing.
      this.select([id]);
      useUiStore.getState().setEmbedLive(id);
      return;
    }
    if (shape.kind === "poll") {
      this.select([id]);
      useUiStore.getState().setPollOpen(id);
      return;
    }
    if (shape.kind === "art") {
      this.select([id]);
      return;
    }
    this.select([id]);
    useUiStore.getState().setEditing(id);
  }

  setLabel(id: NodeId, label: string): void {
    const current = this.scene.get(id);
    if (!current) return;
    const clean = Array.from(label).slice(0, MAX_LABEL_CHARS).join("");
    // Text and comments with nothing in them have no reason to exist.
    if (!clean.trim() && (current.kind === "text" || current.kind === "comment")) {
      this.deleteShapes([id]);
      return;
    }
    if ((current.label ?? "") === clean) return;
    this.updateShapes([{ id, patch: { label: clean } }]);
  }

  /** Rename the board (synced to everyone on it). */
  setTitle(title: string): void {
    if (this.locked) return;
    const clean = title.replace(/\s+/g, " ").trim() || "Untitled board";
    useUiStore.getState().setTitle(clean);
    this.engine.send({ type: "title", seq: this.engine.nextSeq(), title: clean });
    upsertBoard(this.docId, { title: clean, updatedAt: Date.now() });
  }

  /** Insert a template centered in view (one undo step), then fly to it. */
  insertTemplate(id: TemplateId | string, at: Point = this.viewCenter()): void {
    const template = templateById(id);
    if (!template || this.locked) return;
    const built = template.build();
    const ids = new Map(built.map((s) => [s.key, crypto.randomUUID()]));
    const bounds = boundsOf(built.filter((s) => s.props.kind !== "arrow").map((s) => s.props)) ?? { x: 0, y: 0, w: 0, h: 0 };
    const dx = at.x - (bounds.x + bounds.w / 2);
    const dy = at.y - (bounds.y + bounds.h / 2);
    const group = this.beginGroup();
    const shapes = built.map((s) => {
      const p = s.props;
      const moved: ShapeProps = { ...p, x: p.x + dx, y: p.y + dy };
      const from = p.from ? ids.get(p.from) : undefined;
      const to = p.to ? ids.get(p.to) : undefined;
      return { id: ids.get(s.key) ?? crypto.randomUUID(), props: { ...moved, ...(from ? { from } : {}), ...(to ? { to } : {}) } };
    });
    this.#create(shapes, group, true);
    const frames = shapes.filter((s) => s.props.kind === "frame").map((s) => s.id);
    if (frames.length > 0) this.engine.send({ type: "back", seq: this.engine.nextSeq(), ids: frames, group });
    if (!useUiStore.getState().title || useUiStore.getState().title === "Untitled board") this.setTitle(template.name);
    this.renderer.fitTo({ x: bounds.x + dx - 40, y: bounds.y + dy - 60, w: bounds.w + 80, h: bounds.h + 100 });
  }

  // --- editing ----------------------------------------------------------------

  /** Start a gesture: every edit tagged with the returned group undoes as one step. */
  beginGroup(): number {
    this.#flush(); // edits from a previous gesture must not join this one
    return this.#nextGroup++;
  }

  /** Change shapes now (optimistic) and send right away. */
  updateShapes(updates: ReadonlyArray<{ id: NodeId; patch: Patch }>, group?: number): void {
    if (this.locked || updates.length === 0) return;
    this.#flush();
    const seq = this.engine.nextSeq();
    this.scene.updateLocal(updates, seq);
    this.engine.send(group === undefined ? { type: "update", seq, updates } : { type: "update", seq, updates, group });
  }

  /** Change shapes now (optimistic) and queue the engine update for this frame (drags). */
  patchLocal(updates: ReadonlyArray<{ id: NodeId; patch: Patch }>, group?: number): void {
    if (this.locked) return;
    if (group !== this.#pendingGroup) this.#flush();
    const seq = this.engine.nextSeq();
    this.scene.updateLocal(updates, seq);
    for (const { id, patch } of updates) this.#pending.set(id, { ...this.#pending.get(id), ...patch });
    this.#pendingSeq = seq;
    this.#pendingGroup = group;
    this.#flushTimer ??= setTimeout(() => this.#flush(), 50);
  }

  /** Move shapes now (optimistic) and queue the engine update for this frame. */
  moveLocal(moves: ReadonlyArray<{ id: NodeId; x: number; y: number }>, group?: number): void {
    this.patchLocal(
      moves.map(({ id, x, y }) => ({ id, patch: { x, y } })),
      group,
    );
  }

  /** What dragging the selection moves: the selection, plus everything inside selected frames. */
  dragSet(selection: Iterable<NodeId>): ShapeView[] {
    const chosen = new Map<NodeId, ShapeView>();
    for (const id of selection) {
      const s = this.scene.get(id);
      if (s) chosen.set(id, s);
    }
    const frames = [...chosen.values()].filter((s) => s.kind === "frame");
    if (frames.length > 0) {
      for (const s of this.scene.ordered()) {
        if (chosen.has(s.id) || s.kind === "frame") continue;
        const b = visualBounds(s, this.lookup);
        if (frames.some((f) => containsRect(f, b))) chosen.set(s.id, s);
      }
    }
    return [...chosen.values()];
  }

  deleteShapes(ids: readonly NodeId[]): void {
    if (ids.length === 0 || this.locked) return;
    this.#flush();
    const doomed = new Set(ids);
    // Arrows attached to a deleted shape go with it.
    for (const s of this.scene.ordered()) {
      if (s.kind === "arrow" && ((s.from && doomed.has(s.from)) || (s.to && doomed.has(s.to)))) doomed.add(s.id);
    }
    const all = [...doomed];
    this.scene.removeLocal(all);
    this.engine.send({ type: "delete", seq: this.engine.nextSeq(), ids: all });
    const selection = useUiStore.getState().selection;
    if (all.some((id) => selection.has(id))) this.select([...selection].filter((id) => !doomed.has(id)));
  }

  deleteSelection(): void {
    this.deleteShapes([...useUiStore.getState().selection]);
  }

  bringSelectionToFront(): void {
    const ids = [...useUiStore.getState().selection];
    if (ids.length > 0 && !this.locked) this.engine.send({ type: "front", seq: this.engine.nextSeq(), ids });
  }

  sendSelectionToBack(): void {
    const ids = [...useUiStore.getState().selection];
    if (ids.length > 0 && !this.locked) this.engine.send({ type: "back", seq: this.engine.nextSeq(), ids });
  }

  setFillOfSelection(fill: number): void {
    useUiStore.getState().setFill(fill);
    this.updateShapes(this.selected().map((s) => ({ id: s.id, patch: { fill } })));
  }

  nudge(dx: number, dy: number): void {
    const moving = this.dragSet(useUiStore.getState().selection);
    this.updateShapes(moving.filter((s) => !(s.kind === "arrow" && s.from && s.to)).map((s) => ({ id: s.id, patch: { x: s.x + dx, y: s.y + dy } })));
  }

  rotateSelection(by: number): void {
    this.updateShapes(
      this.selected()
        .filter((s) => s.kind !== "arrow" && s.kind !== "comment")
        .map((s) => ({ id: s.id, patch: { rotation: normalizeAngle((s.rotation ?? 0) + by) } })),
    );
  }

  /** Line up the selection's edges or centers. */
  align(edge: Align): void {
    const shapes = this.selected().filter((s) => s.kind !== "arrow");
    const bounds = boundsOf(shapes.map((s) => visualBounds(s, this.lookup)));
    if (!bounds || shapes.length < 2) return;
    this.updateShapes(
      shapes.map((s) => {
        const b = visualBounds(s, this.lookup);
        const offX = s.x - b.x;
        const offY = s.y - b.y;
        const patch: Patch =
          edge === "left"
            ? { x: bounds.x + offX }
            : edge === "right"
              ? { x: bounds.x + bounds.w - b.w + offX }
              : edge === "center"
                ? { x: bounds.x + bounds.w / 2 - b.w / 2 + offX }
                : edge === "top"
                  ? { y: bounds.y + offY }
                  : edge === "bottom"
                    ? { y: bounds.y + bounds.h - b.h + offY }
                    : { y: bounds.y + bounds.h / 2 - b.h / 2 + offY };
        return { id: s.id, patch };
      }),
    );
  }

  /** Space the selection evenly (horizontally or vertically). */
  distribute(axis: "x" | "y"): void {
    const shapes = this.selected()
      .filter((s) => s.kind !== "arrow")
      .map((s) => ({ s, b: visualBounds(s, this.lookup) }))
      .sort((a, b) => (axis === "x" ? a.b.x - b.b.x : a.b.y - b.b.y));
    if (shapes.length < 3) return;
    const first = shapes[0];
    const last = shapes[shapes.length - 1];
    if (!first || !last) return;
    const span = axis === "x" ? last.b.x + last.b.w - first.b.x : last.b.y + last.b.h - first.b.y;
    const total = shapes.reduce((sum, { b }) => sum + (axis === "x" ? b.w : b.h), 0);
    const gap = (span - total) / (shapes.length - 1);
    let cursor = axis === "x" ? first.b.x : first.b.y;
    const updates = shapes.map(({ s, b }) => {
      const patch: Patch = axis === "x" ? { x: cursor + (s.x - b.x) } : { y: cursor + (s.y - b.y) };
      cursor += (axis === "x" ? b.w : b.h) + gap;
      return { id: s.id, patch };
    });
    this.updateShapes(updates);
  }

  /** Wrap the selection in a frame (Ctrl+G). */
  frameSelection(): void {
    const shapes = this.selected();
    const bounds = boundsOf(shapes.map((s) => visualBounds(s, this.lookup)));
    if (!bounds || this.locked) return;
    const pad = 40;
    const group = this.beginGroup();
    const [id] = this.#create([{ props: { kind: "frame", x: bounds.x - pad, y: bounds.y - pad, w: bounds.w + pad * 2, h: bounds.h + pad * 2, fill: 0x7b55e7, label: "Group" } }], group);
    if (!id) return;
    this.engine.send({ type: "back", seq: this.engine.nextSeq(), ids: [id], group });
    this.select([id]);
  }

  // --- clipboard -----------------------------------------------------------------

  copy(): void {
    const shapes = this.dragSet(useUiStore.getState().selection);
    if (shapes.length === 0) return;
    const order = new Map(this.scene.ids().map((id, i) => [id, i]));
    shapes.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    this.#clipboard = { shapes, pastes: 0 };
    void navigator.clipboard?.writeText(JSON.stringify({ type: CLIPBOARD_TAG, shapes })).catch(() => undefined);
  }

  cut(): void {
    this.copy();
    this.deleteSelection();
  }

  /** Paste shapes (offset each time), or plain text as a sticky note. */
  paste(text?: string): void {
    if (this.locked) return;
    let shapes = this.#clipboard?.shapes;
    if (text !== undefined) {
      try {
        const parsed = JSON.parse(text) as { type?: unknown; shapes?: unknown };
        if (parsed.type === CLIPBOARD_TAG && Array.isArray(parsed.shapes)) shapes = parsed.shapes as ShapeView[];
        else shapes = undefined;
      } catch {
        shapes = undefined;
      }
      if (!shapes) {
        const clean = text.trim();
        if (clean) {
          const at = this.#pointer ?? this.viewCenter();
          const [id] = this.#create([{ props: { kind: "rect", x: at.x - 120, y: at.y - 50, w: 240, h: 100, fill: NOTE_FILL, label: clean.slice(0, MAX_LABEL_CHARS) } }]);
          if (id) this.select([id]);
        }
        return;
      }
    }
    if (!shapes || shapes.length === 0) return;
    const clip = this.#clipboard && this.#clipboard.shapes === shapes ? this.#clipboard : { shapes, pastes: 0 };
    clip.pastes += 1;
    this.#clipboard = clip;
    this.#insertCopies(shapes, 24 * clip.pastes, 24 * clip.pastes);
  }

  duplicate(): void {
    const shapes = this.dragSet(useUiStore.getState().selection);
    this.#insertCopies(shapes, 24, 24);
  }

  #insertCopies(shapes: readonly ShapeView[], dx: number, dy: number): void {
    if (shapes.length === 0 || this.locked) return;
    const ids = new Map<NodeId, string>(shapes.map((s) => [s.id, crypto.randomUUID()]));
    const copies = shapes.flatMap(({ id, ...props }) => {
      const copyId = ids.get(id);
      if (!copyId || !props.kind) return [];
      const next: Record<string, unknown> = { ...props, x: props.x + dx, y: props.y + dy };
      // Arrows keep their connections when both ends were copied; otherwise they detach.
      for (const end of ["from", "to"] as const) {
        const ref = props[end];
        if (ref === undefined) continue;
        const mapped = ids.get(ref);
        next[end] = mapped ?? "";
      }
      return [{ id: copyId, props: next as unknown as ShapeProps }];
    });
    const group = this.beginGroup();
    const created = this.#create(copies, group);
    const frames = copies.filter((c) => c.props.kind === "frame").map((c) => c.id);
    if (frames.length > 0) this.engine.send({ type: "back", seq: this.engine.nextSeq(), ids: frames, group });
    this.select(created);
  }

  // --- view ----------------------------------------------------------------------

  fitTo(rect: Rect): void {
    this.renderer.fitTo(rect, 80, 0);
  }

  zoomToFit(maxZoom = 2): void {
    const bounds = boundsOf(this.scene.ordered().map((s) => visualBounds(s, this.lookup)));
    if (bounds) this.renderer.fitTo(bounds, 80, 0, maxZoom);
  }

  zoomToSelection(): void {
    const bounds = boundsOf(this.selected().map((s) => visualBounds(s, this.lookup)));
    if (bounds) this.renderer.fitTo(bounds, 120, 0, 2);
  }

  zoomBy(factor: number): void {
    const { width, height } = this.renderer.screen;
    this.renderer.zoomBy(factor, { x: width / 2, y: height / 2 });
  }

  resetZoom(): void {
    const { width, height } = this.renderer.screen;
    this.renderer.setZoomTarget(1, { x: width / 2, y: height / 2 });
  }

  // --- people ----------------------------------------------------------------------

  follow(clientId: string | undefined): void {
    const ui = useUiStore.getState();
    if (clientId === ui.following) clientId = undefined;
    ui.setFollowing(clientId);
    const peer = clientId ? this.peers.list().find((p) => p.clientId === clientId) : undefined;
    if (peer) ui.setNotice(`Following ${peer.presence.name} — move the canvas to stop`);
  }

  stopFollowing(): void {
    if (useUiStore.getState().following) useUiStore.getState().setFollowing(undefined);
  }

  /** Send an emoji reaction; it floats up from your cursor on everyone's screen. */
  react(emoji: string): void {
    const at = this.#pointer ?? this.viewCenter();
    this.#reaction = { emoji, n: ((this.#reaction?.n ?? 0) + 1) % 1_000_000 };
    this.renderer.spawnReaction(at, emoji);
    this.#schedulePresence();
  }

  // --- team rituals ------------------------------------------------------------------

  /** Who I am on this board (name, color and a stable id). */
  get me(): { readonly id: string; readonly name: string; readonly color: number } {
    return this.#me;
  }

  /** This browser's voter key. */
  get voterId(): string {
    return this.#me.id;
  }

  /** How many votes I've cast on this board (each person gets VOTES_PER_PERSON). */
  myVotes(): number {
    let n = 0;
    for (const s of this.scene.ordered()) if (s.voters?.includes(this.#me.id)) n += 1;
    return n;
  }

  /** Toggle my dot vote on a shape. Returns false when out of votes. */
  toggleVote(id: NodeId): boolean {
    const shape = this.scene.get(id);
    if (!shape || this.locked || shape.kind === "arrow" || shape.kind === "frame") return false;
    const on = !(shape.voters ?? []).includes(this.#me.id);
    if (on && this.myVotes() >= VOTES_PER_PERSON) {
      useUiStore.getState().setNotice(`You've used all ${VOTES_PER_PERSON} votes — click a voted note to take one back`);
      return false;
    }
    const voters = on ? [...(shape.voters ?? []), this.#me.id].sort() : (shape.voters ?? []).filter((v) => v !== this.#me.id);
    this.scene.updateLocal([{ id, patch: { voters } as Partial<ShapeProps> }], this.engine.nextSeq());
    this.engine.send({ type: "vote", seq: this.engine.nextSeq(), id, voter: this.#me.id, on });
    this.renderer.pulse(id);
    return true;
  }

  /** Start (or restart) the shared countdown for everyone on the board. */
  startTimer(ms: number): void {
    if (this.locked) return;
    this.engine.send({ type: "meta", seq: this.engine.nextSeq(), meta: { timerEnd: Date.now() + ms, timerTotal: ms, timerPaused: 0 } });
  }

  pauseTimer(): void {
    const { end, paused } = useUiStore.getState().timer;
    if (!end || paused) return;
    this.engine.send({ type: "meta", seq: this.engine.nextSeq(), meta: { timerPaused: Math.max(1, end - Date.now()) } });
  }

  resumeTimer(): void {
    const { paused } = useUiStore.getState().timer;
    if (!paused) return;
    this.engine.send({ type: "meta", seq: this.engine.nextSeq(), meta: { timerEnd: Date.now() + paused, timerPaused: 0 } });
  }

  addTime(ms: number): void {
    const { end, total, paused } = useUiStore.getState().timer;
    if (!end) return this.startTimer(ms);
    this.engine.send({ type: "meta", seq: this.engine.nextSeq(), meta: paused ? { timerPaused: paused + ms, timerTotal: total + ms } : { timerEnd: end + ms, timerTotal: total + ms } });
  }

  stopTimer(): void {
    this.engine.send({ type: "meta", seq: this.engine.nextSeq(), meta: { timerEnd: 0, timerTotal: 0, timerPaused: 0 } });
  }

  /** Ask everyone to follow my view (they can step away by moving). */
  setSpotlight(on: boolean): void {
    useUiStore.getState().setSpotlight(on);
    if (on) useUiStore.getState().setNotice("Spotlight on: everyone is following your view");
    this.#schedulePresence();
  }

  /** Tell the room I'm in (or out of) the video call: the others connect to me. */
  setInCall(on: boolean): void {
    useUiStore.getState().setCall(on);
    this.#schedulePresence();
  }

  setLaser(on: boolean): void {
    useUiStore.getState().setLaser(on);
    this.renderer.laserOn = on;
    this.#schedulePresence();
  }

  // --- present mode ------------------------------------------------------------------

  /** Frames as slides, in reading order (top to bottom, then left to right). */
  slides(): NodeId[] {
    return this.scene
      .ordered()
      .filter((s) => s.kind === "frame")
      .sort((a, b) => (Math.abs(a.y - b.y) > 120 ? a.y - b.y : a.x - b.x))
      .map((s) => s.id);
  }

  /** Present the board's frames (or just `only`, e.g. a deck the AI just made). */
  startPresenting(only?: readonly NodeId[]): void {
    const slides = only ? only.filter((id) => this.scene.get(id)) : this.slides();
    this.select([]);
    useUiStore.getState().setEditing(undefined);
    useUiStore.getState().setPresenting({ slides, index: 0 });
    this.setSpotlight(true);
    // Presenting hides the panels, which resizes the canvas: frame the slide after that.
    setTimeout(() => this.#showSlide(0, slides), 360);
  }

  goToSlide(index: number): void {
    const presenting = useUiStore.getState().presenting;
    if (!presenting) return;
    const count = Math.max(1, presenting.slides.length);
    const next = Math.min(count - 1, Math.max(0, index));
    useUiStore.getState().setPresenting({ ...presenting, index: next });
    this.#showSlide(next, presenting.slides);
  }

  stopPresenting(): void {
    useUiStore.getState().setPresenting(undefined);
    this.setSpotlight(false);
    this.setLaser(false);
  }

  #showSlide(index: number, slides: readonly NodeId[]): void {
    const id = slides[index];
    const frame = id ? this.scene.get(id) : undefined;
    const target = frame ? visualBounds(frame, this.lookup) : boundsOf(this.scene.ordered().map((s) => visualBounds(s, this.lookup)));
    if (target) this.renderer.fitTo(target, 60, 0, 4, 1100, true);
    if (!frame) return;
    // Animated reveal: once the camera lands, designed slides and charts build in, and
    // everything else pops in top to bottom.
    const inside = this.scene
      .ordered()
      .filter((s) => s.id !== frame.id && s.kind !== "frame" && containsRect(frame, visualBounds(s, this.lookup)))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const designed = inside.filter((s) => s.kind === "slide" || s.kind === "chart");
    useUiStore.getState().reveal(designed.map((s) => s.id), 700);
    clearTimeout(this.#revealTimer);
    inside
      .filter((s) => s.kind !== "slide" && s.kind !== "chart")
      .forEach((s, i) => {
        this.#revealTimer = setTimeout(() => this.renderer.pulse(s.id), 850 + i * 140);
      });
  }

  // --- quick-connect -------------------------------------------------------------------

  /** Create the next step beside a shape, already connected to it, and start typing. */
  quickConnect(id: NodeId, side: "n" | "e" | "s" | "w"): void {
    const source = this.scene.get(id);
    if (!source || this.locked) return;
    const gap = 110;
    const w = source.w;
    const h = source.h;
    const dx = side === "e" ? w + gap : side === "w" ? -(w + gap) : 0;
    const dy = side === "s" ? h + gap : side === "n" ? -(h + gap) : 0;
    let x = source.x + dx;
    let y = source.y + dy;
    // Step past anything already there, so the new step never lands on top of another.
    const others = this.scene.ordered().filter((s) => s.kind !== "arrow" && s.kind !== "frame").map((s) => visualBounds(s, this.lookup));
    const pad = 20;
    for (let i = 0; i < 12 && others.some((b) => intersects(b, { x: x - pad, y: y - pad, w: w + pad * 2, h: h + pad * 2 })); i++) {
      x += dx;
      y += dy;
    }
    const kind = source.kind === "ellipse" || source.kind === "diamond" || source.kind === "rect" ? (source.kind === "ellipse" ? "rect" : source.kind) : "rect";
    const group = this.beginGroup();
    const props: ShapeProps = { kind: kind === "diamond" ? "rect" : kind, x, y, w, h, fill: source.fill, label: " " };
    const [next] = this.#create([{ props }], group, true);
    if (!next) return;
    this.#create([{ props: { kind: "arrow", x: 0, y: 0, w: 1, h: 1, fill: INK, points: "0,0 1,1", from: id, to: next } }], group);
    this.select([next]);
    this.startEditing(next);
  }

  /** Simulated teammates (bots) for demos: see crowd.ts. */
  get crowd(): CrowdSim {
    this.#crowd ??= new CrowdSim(this);
    return this.#crowd;
  }

  /**
   * Top-left of an empty area of size w×h for new content: to the right of everything
   * on the board (or the middle of the view on an empty board), so it never lands on top
   * of existing work.
   */
  freeSpot(w: number, h: number): Point {
    const bounds = boundsOf(this.scene.ordered().map((s) => visualBounds(s, this.lookup)));
    if (!bounds) {
      const c = this.viewCenter();
      return { x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2) };
    }
    return { x: Math.round(bounds.x + bounds.w + 200), y: Math.round(bounds.y) };
  }

  /** The center of an empty w×h area beside the board (for templates and AI results). */
  freeSpotCenter(w: number, h: number): Point {
    const spot = this.freeSpot(w, h);
    return this.scene.size === 0 ? this.viewCenter() : { x: spot.x + w / 2, y: spot.y + h / 2 };
  }

  /** A shape created by a bot teammate (pops in; its own undo step unless grouped). */
  botCreate(props: ShapeProps, group?: number): NodeId | undefined {
    const [id] = this.#create([{ props }], group ?? this.beginGroup());
    if (id) this.renderer.pulse(id);
    return id;
  }

  // --- export ------------------------------------------------------------------------

  #exportSource(): ShapeView[] {
    const selected = this.dragSet(useUiStore.getState().selection);
    return selected.length > 0 ? selected : this.scene.ordered();
  }

  exportSvg(): void {
    const { svg } = toSvg(this.#exportSource(), this.lookup, { theme: this.renderer.theme });
    download(new Blob([svg], { type: "image/svg+xml" }), `${safeFilename(useUiStore.getState().title ?? "board")}.svg`);
  }

  async exportPng(): Promise<void> {
    const { svg, width, height } = toSvg(this.#exportSource(), this.lookup, { theme: this.renderer.theme });
    const png = await svgToPng(svg, width, height, 2);
    download(png, `${safeFilename(useUiStore.getState().title ?? "board")}.png`);
  }

  /** Print-to-PDF: opens the vector export in a print dialog. */
  exportPdf(): void {
    const { svg, width, height } = toSvg(this.#exportSource(), this.lookup, { theme: CANVAS_THEMES.light });
    const win = window.open("", "_blank");
    if (!win) {
      useUiStore.getState().setNotice("Allow pop-ups to export a PDF");
      return;
    }
    const landscape = width > height;
    win.document.write(
      `<!doctype html><title>${(useUiStore.getState().title ?? "Board").replace(/</g, "")}</title><style>@page{size:${landscape ? "landscape" : "portrait"};margin:12mm}html,body{margin:0;height:100%}svg{width:100%;height:auto;max-height:100%}</style>${svg}<script>onload=()=>{print();}</scr` + `ipt>`,
    );
    win.document.close();
  }

  undo(): void {
    if (this.locked) return;
    this.#flush();
    this.engine.send({ type: "undo", seq: this.engine.nextSeq() });
  }

  redo(): void {
    if (this.locked) return;
    this.#flush();
    this.engine.send({ type: "redo", seq: this.engine.nextSeq() });
  }

  /** AI: add a card, fading in (all cards of one AI run share `group`: one undo step). */
  aiCreate(props: ShapeProps, group: number): NodeId {
    const [id] = this.#create([{ props }], group, true);
    return id ?? "";
  }

  /** AI: glide an existing shape into a slot. */
  aiMove(id: NodeId, rect: { x: number; y: number; w: number; h: number }, group: number): void {
    if (!this.scene.get(id)) return;
    this.scene.animate = true;
    this.updateShapes([{ id, patch: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } }], group);
  }

  // --- time travel ---------------------------------------------------------

  /** Open the history panel at the newest version. */
  openHistory(): void {
    if (useUiStore.getState().sync.status !== "online") {
      useUiStore.getState().setNotice("History needs a connection to the server");
      return;
    }
    this.#flush();
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

  /** Scatter `count` random shapes around the view, then zoom out to show them. */
  spawn(count: number): void {
    if (this.locked) return;
    const { width, height } = this.renderer.screen;
    const c = this.viewCenter();
    const zoom = this.renderer.viewport.zoom;
    const spreadX = (width / zoom) * 3;
    const spreadY = (height / zoom) * 3;
    const shapes = Array.from({ length: count }, () => {
      const kind: ShapeKind = Math.random() < 0.6 ? "rect" : "ellipse";
      const w = 24 + Math.random() * 72;
      const h = kind === "ellipse" && Math.random() < 0.5 ? w : 24 + Math.random() * 72;
      return {
        id: crypto.randomUUID(),
        props: { kind, x: c.x + (Math.random() - 0.5) * spreadX, y: c.y + (Math.random() - 0.5) * spreadY, w, h, fill: randomFill() },
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
        this.moveLocal(movers.map((s) => ({ id: s.id, x: s.x + Math.cos(t * 3) * 80, y: s.y + Math.sin(t * 3) * 80 })));
        this.renderer.panBy(Math.cos(t * 0.8) * 1.5, Math.sin(t * 0.8) * 1.5);
        this.renderer.setZoomTarget(baseZoom * (1 + 0.6 * Math.sin(t * 1.4)), anchor);
        if (elapsed < durationMs) return;

        this.renderer.frameListeners.delete(tick);
        ticker.remove(begin);
        ticker.remove(end);
        this.renderer.setZoomTarget(baseZoom, anchor);
        const measured = frames.slice(10);
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

  /** Send queued drag edits to the engine: on the next frame or after 50ms. */
  #flush(): void {
    clearTimeout(this.#flushTimer);
    this.#flushTimer = undefined;
    if (this.#pending.size === 0) return;
    const updates = [...this.#pending].map(([id, patch]) => ({ id, patch }));
    this.#pending.clear();
    const group = this.#pendingGroup;
    this.engine.send(group === undefined ? { type: "update", seq: this.#pendingSeq, updates } : { type: "update", seq: this.#pendingSeq, updates, group });
  }

  #schedulePresence(): void {
    this.#presenceTimer ??= setTimeout(() => {
      this.#presenceTimer = undefined;
      const ui = useUiStore.getState();
      const view = this.renderer.app.renderer ? this.renderer.visibleWorld : undefined;
      this.engine.send({
        type: "presence",
        presence: {
          name: this.#me.name,
          color: this.#me.color,
          cursor: this.#pointer,
          selection: [...ui.selection].slice(0, 200),
          ...(view ? { view } : {}),
          ...(ui.chat ? { chat: ui.chat } : {}),
          ...(this.#reaction ? { reaction: this.#reaction } : {}),
          ...(ui.spotlight ? { spotlight: true } : {}),
          ...(ui.laser ? { laser: true } : {}),
          ...(ui.call ? { call: true } : {}),
        },
      });
    }, PRESENCE_INTERVAL_MS);
  }

  /** Remember this board on the dashboard: name, size and a thumbnail (throttled). */
  #scheduleRegistry(): void {
    this.#registryTimer ??= setTimeout(() => {
      this.#registryTimer = undefined;
      this.#saveRegistry();
    }, REGISTRY_INTERVAL_MS);
  }

  #saveRegistry(): void {
    if (!this.#restored || this.scene.previewing) return;
    const shapes = this.scene.ordered();
    const thumb = shapes.length > 0 ? toSvg(shapes, this.lookup, { theme: CANVAS_THEMES.light, text: false, padding: 30, maxShapes: 400, background: false }).svg : undefined;
    upsertBoard(this.docId, { shapes: shapes.length, updatedAt: Date.now(), ...(thumb ? { thumb } : {}) });
  }

  #onEngine(event: EngineEvent): void {
    const ui = useUiStore.getState();
    switch (event.type) {
      case "sync": {
        const { status, pending, error, readOnly } = event;
        ui.setSync(error === undefined ? { status, pending, readOnly } : { status, pending, readOnly, error });
        if (status !== "online" && this.peers.list().length > 0) {
          this.peers.clear();
          ui.setPeers([]);
          ui.setFollowing(undefined);
        }
        return;
      }
      case "title":
        ui.setTitle(event.title);
        ui.setTimer({ end: event.meta.timerEnd ?? 0, total: event.meta.timerTotal ?? 0, paused: event.meta.timerPaused ?? 0 });
        if (event.title) upsertBoard(this.docId, { title: event.title });
        return;
      case "error":
        console.error(`engine rejected command #${event.seq}: ${event.message}`);
        return;
      case "restored": {
        this.#restored = true;
        if (!event.persistent) ui.setNotice("Offline storage unavailable: edits won't survive a reload");
        else if (event.pending > 0) ui.setNotice(`Restored ${event.pending} unsynced edit${event.pending === 1 ? "" : "s"} from your last session`);
        const template = this.#target.template;
        if (template && event.shapes === 0 && templateById(template)) {
          // Wait one tick for the first patch to land so the board is truly empty.
          setTimeout(() => {
            if (this.scene.size === 0) this.insertTemplate(template, { x: 0, y: 0 });
          }, 0);
        } else if (event.shapes > 0) {
          setTimeout(() => this.zoomToFit(1), 0);
        }
        // Branches: a new branch starts as a copy; a board may have a merge waiting.
        setTimeout(() => {
          if (this.scene.size === 0) seedBranch(this);
          applyPendingMerge(this);
        }, 400);
        upsertBoard(this.docId, {});
        return;
      }
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
      case "presence": {
        const reaction = event.presence?.reaction;
        if (reaction && this.#seenReactions.get(event.clientId) !== reaction.n) {
          // Someone we've only just met may carry an old reaction: don't replay that one.
          const first = !this.peers.list().some((peer) => peer.clientId === event.clientId);
          this.#seenReactions.set(event.clientId, reaction.n);
          const at = event.presence?.cursor ?? (event.presence?.view ? center(event.presence.view) : undefined);
          if (!first && at) this.renderer.spawnReaction(at, reaction.emoji);
        }
        if (!event.presence) {
          this.#seenReactions.delete(event.clientId);
          if (ui.following === event.clientId) ui.setFollowing(undefined);
        }
        // Someone asks everyone to follow them: do, unless we're presenting ourselves.
        if (event.presence?.spotlight && !ui.spotlight && ui.spotlightBy !== event.clientId) {
          ui.setSpotlightBy(event.clientId);
          ui.setFollowing(event.clientId);
          ui.setNotice(`${event.presence.name} is presenting — you're following their view`);
        } else if (ui.spotlightBy === event.clientId && !event.presence?.spotlight) {
          ui.setSpotlightBy(undefined);
          if (ui.following === event.clientId) ui.setFollowing(undefined);
        }
        if (this.peers.update(event.clientId, event.presence)) {
          ui.setPeers(this.peers.list().map((p) => ({ clientId: p.clientId, name: p.presence.name, color: p.presence.color })));
        }
        return;
      }
      case "patch":
        this.scene.applyPatch(event);
        this.#engineMs = event.engineMs;
        if (event.removes.length > 0 && event.removes.some((id) => ui.selection.has(id))) {
          this.select([...ui.selection].filter((id) => this.scene.get(id)));
        }
        this.#scheduleRegistry();
    }
  }

  #onFrame(dtMs: number): void {
    this.#flush();

    const following = useUiStore.getState().following;
    if (following) {
      const view = this.peers.list().find((p) => p.clientId === following)?.presence.view;
      if (view) this.renderer.follow(view, dtMs);
    }
    const v = this.renderer.viewport;
    const key = `${Math.round(v.x)}|${Math.round(v.y)}|${v.zoom.toFixed(3)}|${this.renderer.screen.width}|${this.renderer.screen.height}`;
    if (key !== this.#lastView) {
      this.#lastView = key;
      this.#schedulePresence();
    }

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

export const normalizeAngle = (a: number): number => {
  const tau = Math.PI * 2;
  const r = ((a % tau) + tau) % tau;
  return r > Math.PI ? r - tau : r;
};

/** Ramer–Douglas–Peucker: drop points that don't change the stroke's shape. */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return [...points];
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return [...points];
  let index = 0;
  let max = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    if (!p) continue;
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const len = Math.hypot(dx, dy) || 1;
    const d = Math.abs(dy * p.x - dx * p.y + last.x * first.y - last.y * first.x) / len;
    if (d > max) {
      max = d;
      index = i;
    }
  }
  if (max <= tolerance) return [first, last];
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
}

export { TEMPLATES };

/** Create an editor for a board; safe under React StrictMode's mount → unmount → mount. */
export function createEditor(host: HTMLElement, target: BoardTarget): { ready: Promise<Editor | null>; destroy(): void } {
  let destroyed = false;
  let editor: Editor | undefined;
  const ready = (async () => {
    const instance = new Editor(target);
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
    Object.assign(globalThis, { __editor: instance, __ui: useUiStore });
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
