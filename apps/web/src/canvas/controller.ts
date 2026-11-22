import type { NodeId, ShapeView } from "@canvas/doc";
import { useUiStore, type Tool } from "../state/ui-store";
import { normalizeAngle, type Editor } from "./editor";
import {
  arrowBox,
  arrowEnds,
  boundsOf,
  center,
  handlePositions,
  hitTest,
  intersects,
  rectFromPoints,
  quickConnectPoints,
  resizeBox,
  shapesInRect,
  visualBounds,
  type HandleId,
  type Rect,
} from "./geometry";
import type { Guide } from "./renderer";
import type { Point } from "./viewport";

type Mode =
  | { kind: "idle" }
  | { kind: "pan"; last: Point }
  | { kind: "drag"; start: Point; group: number; origins: ReadonlyArray<{ id: NodeId; x: number; y: number }>; box: Rect; others: Rect[]; moved: boolean }
  | { kind: "marquee"; start: Point; base: ReadonlySet<NodeId> }
  | { kind: "resize"; handle: HandleId; group: number; box: Rect; rotation: number; origins: readonly ShapeView[]; others: Rect[] }
  | { kind: "rotate"; group: number; pivot: Point; startAngle: number; origins: readonly ShapeView[] }
  | { kind: "box"; shape: "rect" | "ellipse" | "diamond" | "frame"; start: Point }
  | { kind: "arrow"; start: Point; from: NodeId | undefined }
  | { kind: "arrowEnd"; id: NodeId; end: "start" | "end"; group: number }
  | { kind: "pen"; points: Point[] }
  | { kind: "quick"; id: NodeId; side: "n" | "e" | "s" | "w"; start: Point };

const TOOL_KEYS: Record<string, Tool> = {
  v: "select",
  h: "hand",
  r: "rect",
  o: "ellipse",
  d: "diamond",
  t: "text",
  n: "note",
  a: "arrow",
  p: "pen",
  f: "frame",
  c: "comment",
};

export const REACTIONS = ["👍", "❤️", "🎉", "😂", "🔥", "👀"] as const;

const HANDLE_CURSORS: Partial<Record<HandleId, string>> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  rotate: "grab",
  start: "crosshair",
  end: "crosshair",
};

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);

/**
 * Pointer, wheel and keyboard input → editor actions.
 *
 *   select tool: click/shift-click select · drag moves (snaps to other shapes; Alt = free)
 *                handles resize (Shift = keep ratio) and rotate (Shift = 15° steps)
 *                drag on empty space = marquee · double-click = edit text / add text
 *   shape tools: drag to draw, click for a default size · arrow: drag between shapes
 *   space+drag / middle / hand tool = pan · wheel = pan · ctrl/⌘+wheel, pinch = zoom
 *
 * While a past version is on screen (time travel) or in view-only mode, the canvas is
 * read-only: pan and zoom still work, editing doesn't.
 */
export class Controller {
  readonly #canvas: HTMLCanvasElement;
  readonly #editor: Editor;
  readonly #disposers: Array<() => void> = [];
  #mode: Mode = { kind: "idle" };
  #space = false;
  /** The shape showing quick-connect handles. */
  #qc: NodeId | undefined;

  constructor(canvas: HTMLCanvasElement, editor: Editor) {
    this.#canvas = canvas;
    this.#editor = editor;
    canvas.style.touchAction = "none";
    canvas.tabIndex = 0;

    this.#on(canvas, "pointerdown", (e) => this.#down(e));
    this.#on(canvas, "pointermove", (e) => this.#move(e));
    this.#on(canvas, "pointerup", (e) => this.#up(e));
    this.#on(canvas, "pointercancel", (e) => this.#up(e));
    this.#on(canvas, "pointerleave", () => this.#editor.updatePointer(null));
    this.#on(canvas, "wheel", (e) => this.#wheel(e), { passive: false });
    this.#on(canvas, "contextmenu", (e) => {
      e.preventDefault();
      const ui = useUiStore.getState();
      if (ui.presenting) return;
      const world = this.#editor.renderer.screenToWorld(this.#point(e));
      const hit = this.#hit(world);
      if (hit !== undefined && !ui.selection.has(hit)) this.#editor.select([hit]);
      ui.setRadial({ x: e.clientX, y: e.clientY, target: hit });
    });
    this.#on(canvas, "dblclick", (e) => this.#doubleClick(e));
    this.#onWindow("keydown", (e) => this.#keyDown(e));
    this.#onWindow("keyup", (e) => this.#keyUp(e));
    this.#onWindow("blur", () => (this.#space = false));
    this.#onWindow("paste", (e) => {
      if (isTyping(e.target)) return;
      e.preventDefault();
      this.#editor.paste(e.clipboardData?.getData("text/plain") ?? undefined);
    });
    this.#onWindow("copy", (e) => {
      if (isTyping(e.target) || useUiStore.getState().selection.size === 0) return;
      e.preventDefault();
      this.#editor.copy();
    });
    this.#onWindow("cut", (e) => {
      if (isTyping(e.target) || useUiStore.getState().selection.size === 0) return;
      e.preventDefault();
      this.#editor.cut();
    });
  }

  destroy(): void {
    for (const dispose of this.#disposers) dispose();
  }

  get #zoom(): number {
    return this.#editor.renderer.viewport.zoom;
  }

  #hit(world: Point, filter?: (s: ShapeView) => boolean): NodeId | undefined {
    const shapes = filter ? this.#editor.scene.ordered().filter(filter) : this.#editor.scene.ordered();
    return hitTest(shapes, world, this.#editor.lookup, 6 / this.#zoom);
  }

  /** A transform handle of the current selection under the pointer. */
  #handleAt(world: Point): { id: HandleId; target: ShapeView | undefined; box: Rect; rotation: number } | undefined {
    const selected = this.#editor.selected();
    if (selected.length === 0 || this.#editor.locked) return undefined;
    const r = 9 / this.#zoom;
    const only = selected.length === 1 ? selected[0] : undefined;
    if (only?.kind === "arrow") {
      const { a, b } = arrowEnds(only, this.#editor.lookup);
      if (Math.hypot(world.x - a.x, world.y - a.y) <= r) return { id: "start", target: only, box: only, rotation: 0 };
      if (Math.hypot(world.x - b.x, world.y - b.y) <= r) return { id: "end", target: only, box: only, rotation: 0 };
      return undefined;
    }
    if (only?.kind === "comment") return undefined;
    const box = only ?? boundsOf(selected.map((s) => visualBounds(s, this.#editor.lookup)));
    if (!box) return undefined;
    const rotation = only?.rotation ?? 0;
    for (const h of handlePositions(box, rotation, this.#zoom)) {
      if (!only && h.id === "rotate") continue;
      if (Math.hypot(world.x - h.p.x, world.y - h.p.y) <= r) return { id: h.id, target: only, box, rotation };
    }
    return undefined;
  }

  /** A quick-connect "+" under the pointer, for the shape currently showing them. */
  #quickAt(world: Point): { id: NodeId; side: "n" | "e" | "s" | "w" } | undefined {
    const id = this.#qc;
    const shape = id === undefined ? undefined : this.#editor.scene.get(id);
    if (!shape || id === undefined) return undefined;
    const r = 13 / this.#zoom;
    for (const { side, p } of quickConnectPoints(shape, this.#zoom)) {
      if (Math.hypot(world.x - p.x, world.y - p.y) <= r) return { id, side };
    }
    return undefined;
  }

  #setQuick(id: NodeId | undefined): void {
    this.#qc = id;
    this.#editor.renderer.quickConnect = id;
  }

  /** Edges of nearby shapes we can snap to (visible, not moving). */
  #snapTargets(moving: ReadonlySet<NodeId>): Rect[] {
    const view = this.#editor.renderer.visibleWorld;
    const out: Rect[] = [];
    for (const s of this.#editor.scene.ordered()) {
      if (moving.has(s.id) || s.kind === "arrow") continue;
      const b = visualBounds(s, this.#editor.lookup);
      if (intersects(b, view)) out.push(b);
      if (out.length >= 600) break;
    }
    return out;
  }

  #down(e: PointerEvent): void {
    const screen = this.#point(e);
    const world = this.#editor.renderer.screenToWorld(screen);
    const ui = useUiStore.getState();
    this.#canvas.focus({ preventScroll: true });
    this.#canvas.setPointerCapture(e.pointerId);

    const readOnly = this.#editor.locked;
    if (e.button === 1 || (e.button === 0 && (this.#space || readOnly || ui.tool === "hand"))) {
      this.#editor.stopFollowing();
      this.#mode = { kind: "pan", last: screen };
      this.#cursor("grabbing");
      return;
    }
    if (e.button !== 0) return;
    if (ui.editing) ui.setEditing(undefined);
    if (ui.radial) ui.setRadial(undefined);
    if (ui.presenting) return; // presenting: the pointer is a laser, not an editor
    if (ui.voting && ui.tool === "select") {
      const hit = this.#hit(world);
      if (hit !== undefined) this.#editor.toggleVote(hit);
      return;
    }
    const quick = ui.tool === "select" ? this.#quickAt(world) : undefined;
    if (quick) {
      this.#mode = { kind: "quick", id: quick.id, side: quick.side, start: world };
      return;
    }

    switch (ui.tool) {
      case "note":
        this.#editor.createNote(world);
        return;
      case "text":
        this.#editor.createText(world);
        return;
      case "comment":
        this.#editor.createComment(world);
        return;
      case "rect":
      case "ellipse":
      case "diamond":
      case "frame":
        this.#mode = { kind: "box", shape: ui.tool, start: world };
        return;
      case "arrow": {
        const from = this.#hit(world, (s) => s.kind !== "arrow" && s.kind !== "path");
        this.#mode = { kind: "arrow", start: world, from };
        return;
      }
      case "pen":
        this.#mode = { kind: "pen", points: [world] };
        return;
      default:
    }

    const handle = this.#handleAt(world);
    if (handle) {
      const group = this.#editor.beginGroup();
      if ((handle.id === "start" || handle.id === "end") && handle.target) {
        this.#mode = { kind: "arrowEnd", id: handle.target.id, end: handle.id, group };
      } else if (handle.id === "rotate") {
        const pivot = center(handle.box);
        this.#mode = { kind: "rotate", group, pivot, startAngle: Math.atan2(world.y - pivot.y, world.x - pivot.x), origins: this.#editor.selected() };
      } else {
        const origins = handle.target ? [handle.target] : this.#editor.dragSet(ui.selection);
        this.#mode = {
          kind: "resize",
          handle: handle.id,
          group,
          box: handle.box,
          rotation: handle.rotation,
          origins,
          others: handle.rotation === 0 ? this.#snapTargets(new Set(origins.map((s) => s.id))) : [],
        };
      }
      return;
    }

    const hit = this.#hit(world);
    if (hit === undefined) {
      this.#mode = { kind: "marquee", start: world, base: e.shiftKey ? ui.selection : new Set() };
      if (!e.shiftKey) this.#editor.select([]);
      return;
    }

    let selection = ui.selection;
    if (e.shiftKey) {
      const next = new Set(selection);
      if (next.has(hit)) next.delete(hit);
      else next.add(hit);
      this.#editor.select(next);
      if (!next.has(hit)) return;
      selection = next;
    } else if (!selection.has(hit)) {
      selection = new Set([hit]);
      this.#editor.select(selection);
    }
    if (readOnly) return;
    // Alt-drag duplicates, then drags the copies.
    if (e.altKey) {
      this.#editor.duplicate();
      selection = useUiStore.getState().selection;
    }
    const moving = this.#editor.dragSet(selection).filter((s) => !(s.kind === "arrow" && s.from && s.to));
    const box = boundsOf(moving.map((s) => visualBounds(s, this.#editor.lookup))) ?? { x: world.x, y: world.y, w: 0, h: 0 };
    this.#mode = {
      kind: "drag",
      start: world,
      group: this.#editor.beginGroup(),
      origins: moving.map((s) => ({ id: s.id, x: s.x, y: s.y })),
      box,
      others: this.#snapTargets(new Set(moving.map((s) => s.id))),
      moved: false,
    };
    this.#cursor("move");
  }

  #move(e: PointerEvent): void {
    const screen = this.#point(e);
    const world = this.#editor.renderer.screenToWorld(screen);
    this.#editor.updatePointer(world);
    const mode = this.#mode;
    const renderer = this.#editor.renderer;
    if (mode.kind !== "idle" && mode.kind !== "quick" && this.#qc !== undefined) this.#setQuick(undefined);
    switch (mode.kind) {
      case "pan":
        renderer.panBy(screen.x - mode.last.x, screen.y - mode.last.y);
        mode.last = screen;
        return;
      case "drag": {
        let dx = world.x - mode.start.x;
        let dy = world.y - mode.start.y;
        if (!mode.moved && Math.hypot(dx, dy) * this.#zoom < 2) return;
        mode.moved = true;
        let guides: Guide[] = [];
        if (!e.altKey) {
          const snapped = snap({ ...mode.box, x: mode.box.x + dx, y: mode.box.y + dy }, mode.others, 7 / this.#zoom);
          dx += snapped.dx;
          dy += snapped.dy;
          guides = snapped.guides;
        }
        if (e.shiftKey) {
          // Shift locks to the dominant axis.
          if (Math.abs(world.x - mode.start.x) > Math.abs(world.y - mode.start.y)) dy = 0;
          else dx = 0;
        }
        renderer.guides = guides;
        this.#editor.moveLocal(
          mode.origins.map((o) => ({ id: o.id, x: o.x + dx, y: o.y + dy })),
          mode.group,
        );
        return;
      }
      case "resize": {
        let next = resizeBox(mode.box, mode.rotation, mode.handle, world, e.shiftKey);
        let guides: Guide[] = [];
        if (mode.rotation === 0 && !e.altKey && mode.others.length > 0) {
          const snapped = snapEdges(next, mode.handle, mode.others, 7 / this.#zoom);
          next = snapped.box;
          guides = snapped.guides;
        }
        renderer.guides = guides;
        const sx = next.w / Math.max(1e-6, mode.box.w);
        const sy = next.h / Math.max(1e-6, mode.box.h);
        if (mode.origins.length === 1 && mode.origins[0] && mode.box === mode.origins[0]) {
          // A single shape: resize it in its own (rotated) frame.
          this.#editor.patchLocal([{ id: mode.origins[0].id, patch: { x: next.x, y: next.y, w: next.w, h: next.h } }], mode.group);
        } else {
          this.#editor.patchLocal(
            mode.origins.map((s) => ({
              id: s.id,
              patch: { x: next.x + (s.x - mode.box.x) * sx, y: next.y + (s.y - mode.box.y) * sy, w: Math.max(1, s.w * sx), h: Math.max(1, s.h * sy) },
            })),
            mode.group,
          );
        }
        return;
      }
      case "rotate": {
        const angle = Math.atan2(world.y - mode.pivot.y, world.x - mode.pivot.x);
        const delta = angle - mode.startAngle;
        const step = Math.PI / 12;
        this.#editor.patchLocal(
          mode.origins
            .filter((s) => s.kind !== "arrow" && s.kind !== "comment")
            .map((s) => {
              let r = (s.rotation ?? 0) + delta;
              if (e.shiftKey) r = Math.round(r / step) * step;
              else if (Math.abs(normalizeAngle(r)) < 0.035) r = 0; // a gentle detent at straight
              return { id: s.id, patch: { rotation: normalizeAngle(r) } };
            }),
          mode.group,
        );
        this.#cursor("grabbing");
        return;
      }
      case "box": {
        let rect = rectFromPoints(mode.start, world);
        if (e.shiftKey) {
          const side = Math.max(rect.w, rect.h);
          rect = { x: world.x < mode.start.x ? mode.start.x - side : mode.start.x, y: world.y < mode.start.y ? mode.start.y - side : mode.start.y, w: side, h: side };
        }
        renderer.draft = { kind: "box", shape: mode.shape, rect };
        return;
      }
      case "arrow": {
        const to = this.#hit(world, (s) => s.kind !== "arrow" && s.kind !== "path" && s.id !== mode.from);
        renderer.attachTarget = to ?? mode.from;
        renderer.draft = { kind: "arrow", a: mode.start, b: world };
        return;
      }
      case "arrowEnd": {
        const arrow = this.#editor.scene.get(mode.id);
        if (!arrow) return;
        const other = arrow[mode.end === "start" ? "to" : "from"];
        const target = this.#hit(world, (s) => s.kind !== "arrow" && s.kind !== "path" && s.id !== other);
        renderer.attachTarget = target;
        const ends = arrowEnds(arrow, this.#editor.lookup);
        const a = mode.end === "start" ? world : ends.a;
        const b = mode.end === "end" ? world : ends.b;
        const key = mode.end === "start" ? "from" : "to";
        this.#editor.patchLocal([{ id: mode.id, patch: { ...arrowBox(a, b), [key]: target ?? "" } }], mode.group);
        return;
      }
      case "quick": {
        // Dragging off a "+" turns into drawing a connector from that shape.
        if (Math.hypot(world.x - mode.start.x, world.y - mode.start.y) * this.#zoom > 8) {
          this.#mode = { kind: "arrow", start: mode.start, from: mode.id };
          this.#setQuick(undefined);
        }
        return;
      }
      case "pen": {
        const last = mode.points[mode.points.length - 1];
        if (!last || Math.hypot(world.x - last.x, world.y - last.y) * this.#zoom >= 1.5) mode.points.push(world);
        renderer.draft = { kind: "path", points: mode.points, color: useUiStore.getState().fill };
        return;
      }
      case "marquee": {
        const rect = rectFromPoints(mode.start, world);
        renderer.marquee = rect;
        this.#editor.select([...mode.base, ...shapesInRect(this.#editor.scene.ordered(), rect, this.#editor.lookup)]);
        return;
      }
      case "idle":
        this.#hoverCursor(screen);
    }
  }

  #up(e: PointerEvent): void {
    if (this.#canvas.hasPointerCapture(e.pointerId)) this.#canvas.releasePointerCapture(e.pointerId);
    const world = this.#editor.renderer.screenToWorld(this.#point(e));
    const mode = this.#mode;
    const renderer = this.#editor.renderer;
    this.#mode = { kind: "idle" };
    renderer.guides = [];
    renderer.draft = undefined;
    renderer.attachTarget = undefined;
    switch (mode.kind) {
      case "marquee":
        renderer.marquee = undefined;
        break;
      case "box": {
        const rect = rectFromPoints(mode.start, world);
        this.#editor.createBox(mode.shape, rect.w * this.#zoom < 6 && rect.h * this.#zoom < 6 ? world : rect);
        break;
      }
      case "arrow": {
        const to = this.#hit(world, (s) => s.kind !== "arrow" && s.kind !== "path" && s.id !== mode.from);
        const far = Math.hypot(world.x - mode.start.x, world.y - mode.start.y) * this.#zoom > 12;
        if (far || to) this.#editor.createArrow(mode.start, far ? world : { x: mode.start.x + 160, y: mode.start.y }, mode.from, to);
        else this.#editor.createArrow(mode.start, { x: mode.start.x + 160, y: mode.start.y }, mode.from);
        useUiStore.getState().setTool("select");
        break;
      }
      case "quick":
        this.#setQuick(undefined);
        this.#editor.quickConnect(mode.id, mode.side);
        break;
      case "pen":
        this.#editor.createPath(mode.points.length === 1 && mode.points[0] ? [mode.points[0], { x: mode.points[0].x + 0.5, y: mode.points[0].y + 0.5 }] : mode.points);
        break;
      default:
    }
    this.#hoverCursor(this.#point(e));
  }

  #doubleClick(e: MouseEvent): void {
    if (useUiStore.getState().tool !== "select" || this.#editor.locked) return;
    const world = this.#editor.renderer.screenToWorld(this.#point(e));
    const hit = this.#hit(world);
    if (hit !== undefined) this.#editor.startEditing(hit);
    else this.#editor.createText(world);
  }

  #wheel(e: WheelEvent): void {
    e.preventDefault();
    this.#editor.stopFollowing();
    const lineScale = e.deltaMode === 1 ? 16 : 1; // Firefox reports lines, not pixels
    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinch arrives as ctrl+wheel with small deltas.
      this.#editor.renderer.zoomBy(Math.exp(-e.deltaY * lineScale * 0.004), this.#point(e));
    } else {
      this.#editor.renderer.panBy(-e.deltaX * lineScale, -e.deltaY * lineScale);
    }
  }

  #keyDown(e: KeyboardEvent): void {
    if (isTyping(e.target)) return;
    const ui = useUiStore.getState();
    const mod = e.ctrlKey || e.metaKey;
    if (ui.editing) {
      // The text box is on its way (React renders it next): keep what's typed meanwhile.
      if (!mod && e.key.length === 1) {
        e.preventDefault();
        ui.setEditBuffer(ui.editBuffer + e.key);
      } else if (e.key === "Enter" && !e.shiftKey && ui.editBuffer) {
        e.preventDefault();
        this.#editor.setLabel(ui.editing, ui.editBuffer.trim());
        ui.setEditing(undefined);
      } else if (e.key === "Escape") ui.setEditing(undefined);
      return;
    }
    const key = e.key.toLowerCase();
    const editor = this.#editor;

    if (mod && key === "k") {
      e.preventDefault();
      ui.setPaletteOpen(!ui.paletteOpen);
      return;
    }
    if (ui.paletteOpen || ui.presenting) return;
    if (e.key === " ") {
      e.preventDefault();
      if (!this.#space && this.#mode.kind === "idle") this.#cursor("grab");
      this.#space = true;
      return;
    }
    if (mod && key === "z") {
      e.preventDefault();
      if (e.shiftKey) editor.redo();
      else editor.undo();
    } else if (mod && key === "y") {
      e.preventDefault();
      editor.redo();
    } else if (mod && key === "d") {
      e.preventDefault();
      editor.duplicate();
    } else if (mod && key === "g") {
      e.preventDefault();
      editor.frameSelection();
    } else if (mod && key === "a") {
      e.preventDefault();
      editor.selectAll();
    } else if (mod && (key === "=" || key === "+")) {
      e.preventDefault();
      editor.zoomBy(1.25);
    } else if (mod && key === "-") {
      e.preventDefault();
      editor.zoomBy(0.8);
    } else if (mod && key === "0") {
      e.preventDefault();
      editor.resetZoom();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      editor.deleteSelection();
    } else if (e.key === "Escape") {
      if (ui.chat !== undefined) ui.setChat(undefined);
      if (editor.scene.previewing || ui.history) editor.closeHistory();
      editor.stopFollowing();
      editor.select([]);
      ui.setTool("select");
    } else if (e.key.startsWith("Arrow") && ui.selection.size > 0) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      editor.nudge(dx, dy);
    } else if (e.key === "]") {
      editor.bringSelectionToFront();
    } else if (e.key === "[") {
      editor.sendSelectionToBack();
    } else if (e.key === "!" || (e.shiftKey && e.code === "Digit1")) {
      editor.zoomToFit();
    } else if (e.key === "@" || (e.shiftKey && e.code === "Digit2")) {
      editor.zoomToSelection();
    } else if (e.key === "/" && !mod) {
      e.preventDefault();
      ui.setChat("");
    } else if (!mod && !e.altKey && !e.shiftKey && /^Digit[1-6]$/.test(e.code)) {
      const emoji = REACTIONS[Number(e.code.slice(5)) - 1];
      if (emoji) editor.react(emoji);
    } else if (!mod && !e.altKey && e.key === "Enter" && ui.selection.size === 1) {
      e.preventDefault();
      const [id] = ui.selection;
      if (id) editor.startEditing(id);
    } else if (!mod && !e.altKey) {
      const tool = TOOL_KEYS[key];
      if (tool && (tool === "select" || tool === "hand" || !editor.locked)) ui.setTool(tool);
    }
  }

  #keyUp(e: KeyboardEvent): void {
    if (e.key === " ") {
      this.#space = false;
      if (this.#mode.kind === "idle") this.#cursor("default");
    }
  }

  #hoverCursor(screen: Point): void {
    const tool = useUiStore.getState().tool;
    if (this.#space || tool === "hand") return this.#cursor("grab");
    if (this.#editor.locked) return this.#cursor("grab");
    if (tool === "pen") return this.#cursor("crosshair");
    if (tool !== "select") return this.#cursor("crosshair");
    const world = this.#editor.renderer.screenToWorld(screen);
    const ui = useUiStore.getState();
    if (ui.presenting) return this.#cursor(ui.laser ? "none" : "default");
    if (ui.voting) return this.#cursor(this.#hit(world) === undefined ? "default" : "pointer");
    if (this.#quickAt(world)) return this.#cursor("copy");
    const handle = this.#handleAt(world);
    if (handle) {
      this.#setQuick(undefined);
      return this.#cursor(HANDLE_CURSORS[handle.id] ?? "default");
    }
    const hit = this.#hit(world);
    const shape = hit === undefined ? undefined : this.#editor.scene.get(hit);
    this.#setQuick(shape && quickConnectPoints(shape, this.#zoom).length > 0 ? hit : this.#nearQuick(world));
    this.#cursor(hit === undefined ? "default" : "move");
  }

  /** Keep the handles while the pointer travels from the shape to a "+". */
  #nearQuick(world: Point): NodeId | undefined {
    const id = this.#qc;
    const shape = id === undefined ? undefined : this.#editor.scene.get(id);
    if (!shape) return undefined;
    const pad = 44 / this.#zoom;
    const inside = world.x > shape.x - pad && world.x < shape.x + shape.w + pad && world.y > shape.y - pad && world.y < shape.y + shape.h + pad;
    return inside ? id : undefined;
  }

  #cursor(cursor: string): void {
    this.#canvas.style.cursor = cursor;
  }

  #point(e: MouseEvent): Point {
    const rect = this.#canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  #on<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler, options);
    this.#disposers.push(() => target.removeEventListener(type, handler, options));
  }

  #onWindow<K extends keyof WindowEventMap>(type: K, handler: (event: WindowEventMap[K]) => void): void {
    window.addEventListener(type, handler);
    this.#disposers.push(() => window.removeEventListener(type, handler));
  }
}

// --- snapping ---------------------------------------------------------------------

const xs = (r: Rect): number[] => [r.x, r.x + r.w / 2, r.x + r.w];
const ys = (r: Rect): number[] => [r.y, r.y + r.h / 2, r.y + r.h];

/**
 * Snap a moving box to the edges and centers of other shapes. Returns the extra offset and
 * the guide lines to draw (from the matched shape across to the moving one).
 */
export function snap(box: Rect, others: readonly Rect[], threshold: number): { dx: number; dy: number; guides: Guide[] } {
  let bestX: { d: number; at: number; other: Rect } | undefined;
  let bestY: { d: number; at: number; other: Rect } | undefined;
  for (const other of others) {
    for (const a of xs(box)) {
      for (const b of xs(other)) {
        const d = b - a;
        if (Math.abs(d) <= threshold && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, at: b, other };
      }
    }
    for (const a of ys(box)) {
      for (const b of ys(other)) {
        const d = b - a;
        if (Math.abs(d) <= threshold && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, at: b, other };
      }
    }
  }
  const dx = bestX?.d ?? 0;
  const dy = bestY?.d ?? 0;
  const moved = { ...box, x: box.x + dx, y: box.y + dy };
  const guides: Guide[] = [];
  if (bestX) {
    const top = Math.min(moved.y, bestX.other.y);
    const bottom = Math.max(moved.y + moved.h, bestX.other.y + bestX.other.h);
    guides.push({ x1: bestX.at, y1: top - 12, x2: bestX.at, y2: bottom + 12 });
  }
  if (bestY) {
    const left = Math.min(moved.x, bestY.other.x);
    const right = Math.max(moved.x + moved.w, bestY.other.x + bestY.other.w);
    guides.push({ x1: left - 12, y1: bestY.at, x2: right + 12, y2: bestY.at });
  }
  return { dx, dy, guides };
}

/** Snap only the edges a resize handle moves. */
function snapEdges(box: Rect, handle: HandleId, others: readonly Rect[], threshold: number): { box: Rect; guides: Guide[] } {
  let { x, y, w, h } = box;
  const guides: Guide[] = [];
  const moveLeft = handle.includes("w");
  const moveRight = handle.includes("e");
  const moveTop = handle === "n" || handle === "nw" || handle === "ne";
  const moveBottom = handle === "s" || handle === "sw" || handle === "se";
  const nearest = (value: number, pick: (r: Rect) => number[]): { at: number; other: Rect } | undefined => {
    let best: { d: number; at: number; other: Rect } | undefined;
    for (const other of others) for (const at of pick(other)) {
      const d = Math.abs(at - value);
      if (d <= threshold && (!best || d < best.d)) best = { d, at, other };
    }
    return best;
  };
  if (moveLeft || moveRight) {
    const edge = moveLeft ? x : x + w;
    const hit = nearest(edge, xs);
    if (hit) {
      if (moveLeft) {
        w += x - hit.at;
        x = hit.at;
      } else w = hit.at - x;
      guides.push({ x1: hit.at, y1: Math.min(y, hit.other.y) - 12, x2: hit.at, y2: Math.max(y + h, hit.other.y + hit.other.h) + 12 });
    }
  }
  if (moveTop || moveBottom) {
    const edge = moveTop ? y : y + h;
    const hit = nearest(edge, ys);
    if (hit) {
      if (moveTop) {
        h += y - hit.at;
        y = hit.at;
      } else h = hit.at - y;
      guides.push({ x1: Math.min(x, hit.other.x) - 12, y1: hit.at, x2: Math.max(x + w, hit.other.x + hit.other.w) + 12, y2: hit.at });
    }
  }
  return w >= 4 && h >= 4 ? { box: { x, y, w, h }, guides } : { box, guides: [] };
}
