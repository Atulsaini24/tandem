import type { NodeId } from "@canvas/doc";
import { useUiStore } from "../state/ui-store";
import type { Editor } from "./editor";
import { hitTest, rectFromPoints, shapesInRect } from "./hit-test";
import type { Point } from "./viewport";

type Mode =
  | { kind: "idle" }
  | { kind: "pan"; last: Point }
  | { kind: "drag"; start: Point; origins: ReadonlyArray<{ id: NodeId; x: number; y: number }> }
  | { kind: "marquee"; start: Point; base: ReadonlySet<NodeId> };

/**
 * Pointer, wheel and keyboard input → editor actions.
 *
 *   drag on empty space  → marquee select (shift adds)
 *   drag on a shape      → move the selection
 *   space+drag / middle  → pan        wheel → pan        ctrl/⌘+wheel, pinch → zoom
 *   V / R / O            → tools      Delete → delete    ⌘A → select all    ] → to front
 */
export class Controller {
  readonly #canvas: HTMLCanvasElement;
  readonly #editor: Editor;
  readonly #disposers: Array<() => void> = [];
  #mode: Mode = { kind: "idle" };
  #space = false;

  constructor(canvas: HTMLCanvasElement, editor: Editor) {
    this.#canvas = canvas;
    this.#editor = editor;
    canvas.style.touchAction = "none";
    canvas.tabIndex = 0;

    this.#on(canvas, "pointerdown", (e) => this.#down(e));
    this.#on(canvas, "pointermove", (e) => this.#move(e));
    this.#on(canvas, "pointerup", (e) => this.#up(e));
    this.#on(canvas, "pointercancel", (e) => this.#up(e));
    this.#on(canvas, "wheel", (e) => this.#wheel(e), { passive: false });
    this.#on(canvas, "contextmenu", (e) => e.preventDefault());
    this.#onWindow("keydown", (e) => this.#keyDown(e));
    this.#onWindow("keyup", (e) => this.#keyUp(e));
    this.#onWindow("blur", () => (this.#space = false));
  }

  destroy(): void {
    for (const dispose of this.#disposers) dispose();
  }

  #down(e: PointerEvent): void {
    const screen = this.#point(e);
    const world = this.#editor.renderer.screenToWorld(screen);
    const ui = useUiStore.getState();
    this.#canvas.setPointerCapture(e.pointerId);

    if (e.button === 1 || (e.button === 0 && this.#space)) {
      this.#mode = { kind: "pan", last: screen };
      this.#cursor("grabbing");
      return;
    }
    if (e.button !== 0) return;
    if (ui.tool !== "select") {
      this.#editor.createShape(ui.tool, world);
      return;
    }

    const scene = this.#editor.scene;
    const hit = hitTest(scene.ordered(), world);
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
    const origins = [...selection].flatMap((id) => {
      const shape = scene.get(id);
      return shape ? [{ id, x: shape.x, y: shape.y }] : [];
    });
    this.#mode = { kind: "drag", start: world, origins };
    this.#cursor("move");
  }

  #move(e: PointerEvent): void {
    const screen = this.#point(e);
    const mode = this.#mode;
    switch (mode.kind) {
      case "pan":
        this.#editor.renderer.panBy(screen.x - mode.last.x, screen.y - mode.last.y);
        mode.last = screen;
        return;
      case "drag": {
        const world = this.#editor.renderer.screenToWorld(screen);
        const dx = world.x - mode.start.x;
        const dy = world.y - mode.start.y;
        this.#editor.moveLocal(mode.origins.map((o) => ({ id: o.id, x: o.x + dx, y: o.y + dy })));
        return;
      }
      case "marquee": {
        const rect = rectFromPoints(mode.start, this.#editor.renderer.screenToWorld(screen));
        this.#editor.renderer.marquee = rect;
        this.#editor.select([...mode.base, ...shapesInRect(this.#editor.scene.ordered(), rect)]);
        return;
      }
      case "idle":
        this.#hoverCursor(screen);
    }
  }

  #up(e: PointerEvent): void {
    if (this.#canvas.hasPointerCapture(e.pointerId)) this.#canvas.releasePointerCapture(e.pointerId);
    if (this.#mode.kind === "marquee") this.#editor.renderer.marquee = undefined;
    this.#mode = { kind: "idle" };
    this.#hoverCursor(this.#point(e));
  }

  #wheel(e: WheelEvent): void {
    e.preventDefault();
    const lineScale = e.deltaMode === 1 ? 16 : 1; // Firefox reports lines, not pixels
    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinch arrives as ctrl+wheel with small deltas.
      this.#editor.renderer.zoomBy(Math.exp(-e.deltaY * lineScale * 0.004), this.#point(e));
    } else {
      this.#editor.renderer.panBy(-e.deltaX * lineScale, -e.deltaY * lineScale);
    }
  }

  #keyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === " ") {
      e.preventDefault();
      if (!this.#space && this.#mode.kind === "idle") this.#cursor("grab");
      this.#space = true;
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      this.#editor.deleteSelection();
    } else if (e.key === "Escape") {
      this.#editor.select([]);
      useUiStore.getState().setTool("select");
    } else if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      this.#editor.selectAll();
    } else if (e.key === "]") {
      this.#editor.bringSelectionToFront();
    } else if (!mod && !e.altKey) {
      const tool = ({ v: "select", r: "rect", o: "ellipse" } as const)[e.key.toLowerCase() as "v" | "r" | "o"];
      if (tool) useUiStore.getState().setTool(tool);
    }
  }

  #keyUp(e: KeyboardEvent): void {
    if (e.key === " ") {
      this.#space = false;
      if (this.#mode.kind === "idle") this.#cursor("default");
    }
  }

  #hoverCursor(screen: Point): void {
    if (this.#space) return this.#cursor("grab");
    if (useUiStore.getState().tool !== "select") return this.#cursor("crosshair");
    const hit = hitTest(this.#editor.scene.ordered(), this.#editor.renderer.screenToWorld(screen));
    this.#cursor(hit === undefined ? "default" : "move");
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
