import { Application, Container, Graphics, NineSliceSprite, Sprite, Text, Texture, TilingSprite } from "pixi.js";
import type { NodeId, ShapeView } from "@canvas/doc";
import {
  FRAME_TITLE_H,
  arrowEnds,
  boundsOf,
  corners,
  handlePositions,
  quickConnectPoints,
  visualBounds,
  type Rect,
} from "./geometry";
import type { Peer, Peers } from "./peers";
import type { Scene } from "./scene";
import { CANVAS_THEMES, displayFill, inkColor, labelColor, type CanvasTheme } from "./theme";
import { clampZoom, panBy, screenToWorld, stepZoom, worldToScreen, type Point, type Viewport } from "./viewport";

/** Geometry a node is drawn with right now (it may be mid-animation). */
interface Pose {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  alpha: number;
}

interface Tween {
  readonly from: Pose;
  readonly to: Pose;
  elapsed: number;
  /** Destroy the node when the tween ends (it faded out of existence). */
  readonly dispose: boolean;
}

/**
 * One shape on screen. `holder` sits at the shape's center and carries its rotation, so
 * the body, label and shadow rotate together. Rectangles and ellipses are sprites of a
 * few shared textures (tinted), so thousands of them still batch into a handful of draw
 * calls. Diamonds, frames, arrows, pen strokes and comments are vector Graphics.
 */
interface ShapeNode {
  readonly id: NodeId;
  readonly holder: Container;
  body: Sprite | NineSliceSprite | Graphics | undefined;
  bodyType: "nine" | "circle" | "graphics" | "none";
  shadow: NineSliceSprite | undefined;
  label: Text | undefined;
  /** Extra text (frame titles, comment authors). */
  caption: Text | undefined;
  pose: Pose;
  view: ShapeView;
  /** Cache key of what a Graphics body was last drawn with. */
  drawn: string;
  /** Spring "pop" (ms elapsed; undefined = at rest). */
  pop: number | undefined;
  /** Dot-vote badge. */
  badge: Container | undefined;
  badgeKey: string;
}

/** A glowing laser trail: world points with the time they were added. */
interface Trail {
  readonly color: number;
  readonly points: Array<{ x: number; y: number; at: number }>;
}

const LASER_MS = 650;
const POP_MS = 520;
/** Damped spring from 0 to 1 with a little overshoot. */
const springPop = (t: number): number => 1 - Math.exp(-7 * t) * Math.cos(11 * t);

/** A floating emoji reaction (screen space). */
interface Floater {
  readonly text: Text;
  readonly start: Point;
  elapsed: number;
  readonly drift: number;
}

export interface Guide {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** What the active tool is drawing before it becomes a shape. */
export type Draft =
  | { readonly kind: "box"; readonly shape: "rect" | "ellipse" | "diamond" | "frame" | "text"; readonly rect: Rect }
  | { readonly kind: "arrow"; readonly a: Point; readonly b: Point }
  | { readonly kind: "path"; readonly points: readonly Point[]; readonly color: number };

const TWEEN_MS = 320;
const FLOAT_MS = 1_700;
const GRID_SPACING = 24;
/** Above this many selected shapes, draw one bounding box instead of every outline. */
const MAX_OUTLINES = 300;
const FONT = "Inter, Helvetica Neue, Arial, sans-serif";
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
const poseOf = (v: ShapeView, alpha = 1): Pose => ({ x: v.x, y: v.y, w: v.w, h: v.h, rotation: v.rotation ?? 0, alpha });
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

interface CursorView {
  readonly root: Container;
  readonly name: string;
  readonly color: number;
  chat: Container | undefined;
  chatText: string;
}

/** A remote cursor: arrow + name tag, drawn in screen space so it stays the same size at any zoom. */
function buildCursor(name: string, color: number): CursorView {
  const root = new Container();
  const arrow = new Graphics()
    .poly([0, 0, 0, 17, 4.6, 12.8, 7.6, 19.2, 10.4, 18, 7.4, 11.7, 13, 11.7])
    .fill(color)
    .stroke({ width: 1.5, color: 0xffffff, alignment: 0 });
  const label = new Text({ text: name, style: { fontFamily: FONT, fontSize: 11, fontWeight: "700", fill: 0xffffff } });
  label.position.set(20, 19);
  const tag = new Graphics().roundRect(14, 16, label.width + 12, 18, 9).fill(color);
  root.addChild(arrow, tag, label);
  return { root, name, color, chat: undefined, chatText: "" };
}

function buildChat(text: string, color: number): Container {
  const root = new Container();
  const label = new Text({
    text,
    style: { fontFamily: FONT, fontSize: 14, fontWeight: "600", fill: 0xffffff, wordWrap: true, wordWrapWidth: 220, breakWords: true },
  });
  label.position.set(26, 42);
  const bubble = new Graphics().roundRect(14, 36, label.width + 24, label.height + 12, 14).fill(color);
  root.addChild(bubble, label);
  return root;
}

export class Renderer {
  readonly app = new Application();
  readonly frameListeners = new Set<(dtMs: number) => void>();
  viewport: Viewport = { x: 0, y: 0, zoom: 1 };

  readonly #scene: Scene;
  readonly #getSelection: () => ReadonlySet<NodeId>;
  readonly #peers: Peers;
  readonly #cursorLayer = new Container();
  readonly #floatLayer = new Container();
  readonly #cursors = new Map<string, CursorView>();
  readonly #floaters: Floater[] = [];
  #peersVersion = -1;
  readonly #world = new Container();
  readonly #layer = new Container();
  readonly #overlay = new Graphics();
  readonly #nodes = new Map<NodeId, ShapeNode>();
  readonly #tweens = new Map<ShapeNode, Tween>();
  readonly #dying = new Set<ShapeNode>();
  readonly #arrows = new Set<NodeId>();
  #grid: TilingSprite | undefined;
  #circle: Texture | undefined;
  #rounded: Texture | undefined;
  #soft: Texture | undefined;
  #dot: Texture | undefined;
  #theme: CanvasTheme = CANVAS_THEMES.light;
  #zoomTarget = 1;
  #zoomAnchor: Point = { x: 0, y: 0 };
  #flight: { from: Viewport; to: Viewport; elapsed: number; ms: number; arc: boolean } | undefined;
  readonly #laser = new Graphics();
  readonly #trails = new Map<string, Trail>();
  #laserWasDrawn = false;
  #quickConnect: NodeId | undefined;
  #createdThisFrame = 0;
  /** Identity of whoever is viewing, to highlight their own votes. */
  voter = "";
  #overlayDirty = true;
  #arrowsDirty = false;
  #lastSelection: ReadonlySet<NodeId> | undefined;
  #marquee: Rect | undefined;
  #guides: readonly Guide[] = [];
  #draft: Draft | undefined;
  #attachTarget: NodeId | undefined;
  #hiddenLabel: NodeId | undefined;
  #showHandles = true;

  constructor(scene: Scene, getSelection: () => ReadonlySet<NodeId>, peers: Peers) {
    this.#scene = scene;
    this.#getSelection = getSelection;
    this.#peers = peers;
  }

  async init(host: HTMLElement, theme: CanvasTheme): Promise<void> {
    this.#theme = theme;
    await this.app.init({
      resizeTo: host,
      background: theme.background,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio, 2),
      preference: "webgl",
    });
    host.appendChild(this.app.canvas);

    const gen = (g: Graphics): Texture => this.app.renderer.generateTexture({ target: g, antialias: true, resolution: 2 });
    this.#circle = gen(new Graphics().circle(128, 128, 128).fill(0xffffff));
    this.#rounded = gen(new Graphics().roundRect(0, 0, 48, 48, 9).fill(0xffffff));
    // A soft-edged rounded rect: stacked translucent layers read as a blurred shadow.
    const soft = new Graphics();
    for (let i = 0; i < 10; i++) soft.roundRect(i, i, 64 - i * 2, 64 - i * 2, 20 - i).fill({ color: 0xffffff, alpha: 0.1 });
    this.#soft = gen(soft);
    this.#dot = this.#makeDot(theme);
    this.#grid = new TilingSprite({ texture: this.#dot, width: this.app.screen.width, height: this.app.screen.height });

    // No Pixi hit-testing: we do our own (see geometry.ts).
    this.app.stage.eventMode = "none";
    this.#world.addChild(this.#layer, this.#overlay, this.#laser);
    // Cursors and reactions live above the world, in screen space.
    this.app.stage.addChild(this.#grid, this.#world, this.#floatLayer, this.#cursorLayer);

    this.viewport = { x: this.app.screen.width / 2, y: this.app.screen.height / 2, zoom: 1 };
    this.#zoomTarget = 1;
    this.app.ticker.add((ticker) => this.#frame(ticker.deltaMS));
  }

  get theme(): CanvasTheme {
    return this.#theme;
  }

  /** Switch colors (light/dark): background, grid dots, ink. Shapes keep their fills. */
  setTheme(theme: CanvasTheme): void {
    if (theme === this.#theme) return;
    this.#theme = theme;
    this.app.renderer.background.color = theme.background;
    const old = this.#dot;
    this.#dot = this.#makeDot(theme);
    if (this.#grid) this.#grid.texture = this.#dot;
    old?.destroy(true);
    this.#overlayDirty = true;
    for (const node of this.#nodes.values()) {
      node.drawn = "";
      this.#applyLook(node);
      this.#place(node);
    }
    this.#arrowsDirty = true;
  }

  #makeDot(theme: CanvasTheme): Texture {
    return this.app.renderer.generateTexture({
      target: new Graphics()
        .rect(0, 0, GRID_SPACING, GRID_SPACING)
        .fill({ color: theme.background, alpha: 0 })
        .circle(GRID_SPACING / 2, GRID_SPACING / 2, 1.1)
        .fill(theme.gridDot),
      resolution: 2,
    });
  }

  get screen(): { width: number; height: number } {
    return { width: this.app.screen.width, height: this.app.screen.height };
  }

  /** The world rectangle currently on screen. */
  get visibleWorld(): Rect {
    const a = this.screenToWorld({ x: 0, y: 0 });
    const b = this.screenToWorld({ x: this.screen.width, y: this.screen.height });
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  }

  screenToWorld(p: Point): Point {
    return screenToWorld(this.viewport, p);
  }

  worldToScreen(p: Point): Point {
    return worldToScreen(this.viewport, p);
  }

  panBy(dx: number, dy: number): void {
    this.#flight = undefined; // the user grabbing the canvas wins over any camera animation
    this.viewport = panBy(this.viewport, dx, dy);
    this.#overlayDirty = true;
  }

  /** Animated zoom by `factor` around a screen point. */
  zoomBy(factor: number, anchor: Point): void {
    this.setZoomTarget(this.#zoomTarget * factor, anchor);
  }

  setZoomTarget(zoom: number, anchor: Point): void {
    this.#flight = undefined;
    this.#zoomTarget = clampZoom(zoom);
    this.#zoomAnchor = anchor;
  }

  /** Fly the camera so world point `p` is centered, at `zoom` (default: current). */
  centerOn(p: Point, zoom = this.viewport.zoom, ms = 450): void {
    const { width, height } = this.screen;
    const z = clampZoom(zoom);
    this.#fly({ zoom: z, x: width / 2 - p.x * z, y: height / 2 - p.y * z }, ms);
  }

  /**
   * Animate the camera so `rect` (world coordinates) fills the view. `maxZoom` caps how far
   * it zooms in; `insetRight` keeps it clear of a panel covering the right edge.
   */
  fitTo(rect: Rect, padding = 80, insetRight = 0, maxZoom = 1, ms = 650, arc = false): void {
    const { height } = this.screen;
    const width = Math.max(200, this.screen.width - insetRight);
    const zoom = clampZoom(Math.min(maxZoom, (width - padding * 2) / Math.max(1, rect.w), (height - padding * 2) / Math.max(1, rect.h)));
    this.#fly({ zoom, x: width / 2 - (rect.x + rect.w / 2) * zoom, y: height / 2 - (rect.y + rect.h / 2) * zoom }, ms, arc);
  }

  /** Follow mode: ease toward showing exactly `rect` every frame (no animation restart). */
  follow(rect: Rect, dtMs: number): void {
    const { width, height } = this.screen;
    const zoom = clampZoom(Math.min(width / Math.max(1, rect.w), height / Math.max(1, rect.h)));
    const target = { zoom, x: width / 2 - (rect.x + rect.w / 2) * zoom, y: height / 2 - (rect.y + rect.h / 2) * zoom };
    const t = 1 - Math.exp((-8 * dtMs) / 1000);
    const v = this.viewport;
    this.viewport = { zoom: Math.exp(lerp(Math.log(v.zoom), Math.log(target.zoom), t)), x: lerp(v.x, target.x, t), y: lerp(v.y, target.y, t) };
    this.#zoomTarget = this.viewport.zoom;
    this.#flight = undefined;
    this.#overlayDirty = true;
  }

  #fly(to: Viewport, ms: number, arc = false): void {
    this.#flight = { from: this.viewport, to, elapsed: 0, ms, arc };
    this.#zoomTarget = to.zoom;
  }

  #stepFlight(dtMs: number): void {
    const flight = this.#flight;
    if (!flight) return;
    flight.elapsed += dtMs;
    const raw = Math.min(1, flight.elapsed / flight.ms);
    const t = flight.arc ? (raw < 0.5 ? 4 * raw ** 3 : 1 - (-2 * raw + 2) ** 3 / 2) : easeOutCubic(raw);
    const { from, to } = flight;
    if (flight.arc) {
      // Cinematic: pull back mid-flight, then dive in (zoom along a dip, centers in world space).
      const { width, height } = this.screen;
      const c0 = { x: (width / 2 - from.x) / from.zoom, y: (height / 2 - from.y) / from.zoom };
      const c1 = { x: (width / 2 - to.x) / to.zoom, y: (height / 2 - to.y) / to.zoom };
      const dist = Math.hypot(c1.x - c0.x, c1.y - c0.y);
      const dip = Math.min(0.85, dist / (dist + width / Math.min(from.zoom, to.zoom)));
      const logZoom = lerp(Math.log(from.zoom), Math.log(to.zoom), t) - Math.sin(Math.PI * t) * dip * 1.4;
      const zoom = Math.exp(logZoom);
      const c = { x: lerp(c0.x, c1.x, t), y: lerp(c0.y, c1.y, t) };
      this.viewport = { zoom, x: width / 2 - c.x * zoom, y: height / 2 - c.y * zoom };
    } else {
      // Zoom in log space; position follows so the motion reads as one camera move.
      const zoom = Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * t);
      this.viewport = { zoom, x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) };
    }
    this.#overlayDirty = true;
    if (flight.elapsed >= flight.ms) this.#flight = undefined;
  }

  set marquee(rect: Rect | undefined) {
    this.#marquee = rect;
    this.#overlayDirty = true;
  }

  set guides(guides: readonly Guide[]) {
    if (guides.length === 0 && this.#guides.length === 0) return;
    this.#guides = guides;
    this.#overlayDirty = true;
  }

  set draft(draft: Draft | undefined) {
    this.#draft = draft;
    this.#overlayDirty = true;
  }

  /** Highlight the shape an arrow end would attach to. */
  set attachTarget(id: NodeId | undefined) {
    if (id === this.#attachTarget) return;
    this.#attachTarget = id;
    this.#overlayDirty = true;
  }

  /** Hide a label while it's being edited in the DOM (no double text). */
  set hiddenLabel(id: NodeId | undefined) {
    if (id === this.#hiddenLabel) return;
    const before = this.#hiddenLabel;
    this.#hiddenLabel = id;
    for (const nodeId of [before, id]) {
      const node = nodeId === undefined ? undefined : this.#nodes.get(nodeId);
      if (node?.label) node.label.visible = node.id !== id;
    }
  }

  set showHandles(show: boolean) {
    if (show === this.#showHandles) return;
    this.#showHandles = show;
    this.#overlayDirty = true;
  }

  /** The shape as currently drawn (mid-animation geometry), for arrows that follow it. */
  readonly lookup = (id: NodeId): ShapeView | undefined => {
    const node = this.#nodes.get(id);
    if (!node) return this.#scene.get(id);
    const { x, y, w, h, rotation } = node.pose;
    return { ...node.view, x, y, w, h, rotation };
  };

  /** A springy "pop" on a shape (created, voted). */
  pulse(id: NodeId): void {
    const node = this.#nodes.get(id);
    if (node && node.view.kind !== "arrow") node.pop = 0;
  }

  set laserOn(on: boolean) {
    if (!on) this.#trails.delete("me");
  }

  /** Add a point to a laser trail (key = who). */
  addLaserPoint(key: string, p: Point, color: number): void {
    let trail = this.#trails.get(key);
    if (!trail) {
      trail = { color, points: [] };
      this.#trails.set(key, trail);
    }
    const last = trail.points[trail.points.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) * this.viewport.zoom < 1.5) {
      last.at = performance.now();
      return;
    }
    trail.points.push({ x: p.x, y: p.y, at: performance.now() });
  }

  /** Show the quick-connect "+" handles around this shape. */
  set quickConnect(id: NodeId | undefined) {
    if (id === this.#quickConnect) return;
    this.#quickConnect = id;
    this.#overlayDirty = true;
  }

  /** Float an emoji up from a world point (reactions). */
  spawnReaction(world: Point, emoji: string): void {
    const start = this.worldToScreen(world);
    const text = new Text({ text: emoji, style: { fontFamily: "Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif", fontSize: 34 } });
    text.anchor.set(0.5);
    text.position.set(start.x, start.y);
    this.#floatLayer.addChild(text);
    this.#floaters.push({ text, start, elapsed: 0, drift: (Math.random() - 0.5) * 60 });
  }

  destroy(): void {
    this.frameListeners.clear();
    // Don't destroy textures wholesale: Texture.WHITE is a shared global.
    this.app.destroy({ removeView: true }, { children: true });
    this.#circle?.destroy(true);
    this.#rounded?.destroy(true);
    this.#soft?.destroy(true);
    this.#dot?.destroy(true);
  }

  #frame(dtMs: number): void {
    if (this.#flight) this.#stepFlight(dtMs);
    else if (this.viewport.zoom !== this.#zoomTarget) {
      this.viewport = stepZoom(this.viewport, this.#zoomTarget, this.#zoomAnchor, dtMs);
      this.#overlayDirty = true;
    }
    const v = this.viewport;
    this.#world.position.set(v.x, v.y);
    this.#world.scale.set(v.zoom);
    this.#updateGrid(v);
    this.#syncScene();

    if (this.#tweens.size > 0) this.#stepTweens(dtMs);
    if (this.#arrowsDirty) this.#drawArrows();
    this.#peers.step(dtMs);
    this.#drawCursors(v);
    if (this.#floaters.length > 0) this.#stepFloaters(dtMs);
    this.#stepPops(dtMs);
    this.#drawLaser();
    this.#createdThisFrame = 0;
    if (this.#peers.version !== this.#peersVersion) {
      this.#peersVersion = this.#peers.version;
      this.#overlayDirty = true; // remote selections may have changed
    }

    const selection = this.#getSelection();
    if (selection !== this.#lastSelection) {
      this.#lastSelection = selection;
      this.#overlayDirty = true;
    }
    if (this.#overlayDirty) this.#drawOverlay(selection);

    for (const listener of this.frameListeners) listener(dtMs);
  }

  #updateGrid(v: Viewport): void {
    const grid = this.#grid;
    if (!grid) return;
    grid.width = this.app.screen.width;
    grid.height = this.app.screen.height;
    grid.tilePosition.set(v.x, v.y);
    grid.tileScale.set(v.zoom);
    // Fade the dots out when zoomed far out, before they turn into noise.
    grid.alpha = Math.min(1, Math.max(0, (v.zoom - 0.3) / 0.4));
  }

  /** Apply only what changed since the last frame. */
  #syncScene(): void {
    const scene = this.#scene;
    if (scene.dirty.size === 0 && !scene.orderDirty) return;
    const animate = scene.animate;
    scene.animate = false;

    for (const id of scene.dirty) {
      const view = scene.get(id);
      const node = this.#nodes.get(id);
      if (!view) {
        if (!node) continue;
        this.#nodes.delete(id);
        this.#arrows.delete(id);
        if (animate) {
          this.#dying.add(node);
          this.#tween(node, { ...node.pose, alpha: 0 }, true);
        } else this.#dispose(node);
        continue;
      }
      if (view.kind === "arrow") this.#arrows.add(id);
      else this.#arrows.delete(id);
      if (!node) {
        const created = this.#create(view);
        if (animate) {
          created.pose.alpha = 0;
          created.holder.alpha = 0;
          this.#tween(created, poseOf(view), false);
        }
        continue;
      }
      const target = poseOf(view);
      const running = this.#tweens.get(node);
      node.view = view;
      this.#applyLook(node);
      if (animate) this.#tween(node, target, false);
      else if (running && !running.dispose && samePose(running.to, target)) {
        // The worker confirming the geometry this node is already animating to: let the
        // animation finish instead of snapping to the end (AI cards fly in this way).
      } else {
        this.#tweens.delete(node);
        node.pose = target;
        this.#place(node);
      }
    }
    scene.dirty.clear();
    this.#overlayDirty = true;
    this.#arrowsDirty = true;

    if (scene.orderDirty) {
      this.#layer.removeChildren();
      for (const id of scene.ids()) {
        const node = this.#nodes.get(id);
        if (node) this.#layer.addChild(node.holder);
      }
      // Shapes fading out of existence stay on screen (on top) until their tween ends.
      for (const node of this.#dying) this.#layer.addChild(node.holder);
      scene.orderDirty = false;
    }
  }

  #create(view: ShapeView): ShapeNode {
    const holder = new Container();
    const node: ShapeNode = {
      id: view.id,
      holder,
      body: undefined,
      bodyType: "none",
      shadow: undefined,
      label: undefined,
      caption: undefined,
      pose: poseOf(view),
      view,
      drawn: "",
      pop: undefined,
      badge: undefined,
      badgeKey: "",
    };
    this.#nodes.set(view.id, node);
    this.#layer.addChild(holder);
    this.#applyLook(node);
    this.#place(node);
    this.#createdThisFrame += 1;
    if (this.#createdThisFrame <= 40 && view.kind !== "arrow" && this.#nodes.size > 1) node.pop = 0;
    return node;
  }

  #dispose(node: ShapeNode): void {
    this.#tweens.delete(node);
    this.#dying.delete(node);
    this.#layer.removeChild(node.holder);
    node.holder.destroy({ children: true });
  }

  #tween(node: ShapeNode, to: Pose, dispose: boolean): void {
    this.#tweens.set(node, { from: { ...node.pose }, to, elapsed: 0, dispose });
  }

  #stepTweens(dtMs: number): void {
    for (const [node, tween] of this.#tweens) {
      tween.elapsed += dtMs;
      const t = easeOutCubic(Math.min(1, tween.elapsed / TWEEN_MS));
      const { from, to } = tween;
      node.pose = {
        x: lerp(from.x, to.x, t),
        y: lerp(from.y, to.y, t),
        w: lerp(from.w, to.w, t),
        h: lerp(from.h, to.h, t),
        rotation: lerp(from.rotation, to.rotation, t),
        alpha: lerp(from.alpha, to.alpha, t),
      };
      this.#place(node);
      if (tween.elapsed < TWEEN_MS) continue;
      this.#tweens.delete(node);
      if (tween.dispose) this.#dispose(node);
    }
    this.#arrowsDirty = true;
    this.#overlayDirty = true;
  }

  /** Which body a shape needs. Tiny rects use the plain texture (no corner artifacts). */
  #bodyTypeFor(view: ShapeView): ShapeNode["bodyType"] {
    switch (view.kind) {
      case "rect":
        return "nine";
      case "ellipse":
        return "circle";
      case "text":
        return "none";
      default:
        return "graphics";
    }
  }

  /** Body type, colors and text. Geometry is applied separately by #place. */
  #applyLook(node: ShapeNode): void {
    const view = node.view;
    const type = this.#bodyTypeFor(view);
    if (type !== node.bodyType) {
      node.body?.destroy();
      node.body = undefined;
      if (type === "nine" && this.#rounded) {
        node.body = new NineSliceSprite({ texture: this.#rounded, leftWidth: 12, rightWidth: 12, topHeight: 12, bottomHeight: 12 });
      } else if (type === "circle" && this.#circle) node.body = new Sprite(this.#circle);
      else if (type === "graphics") node.body = new Graphics();
      if (node.body) node.holder.addChildAt(node.body, 0);
      node.bodyType = type;
      node.drawn = "";
    }
    const fill = displayFill(view.fill, this.#theme);
    if (node.body && !(node.body instanceof Graphics)) node.body.tint = fill;

    // Labeled cards (sticky notes, AI boards) float on a soft shadow.
    const wantsShadow = view.kind === "rect" && view.label !== undefined;
    if (wantsShadow && !node.shadow && this.#soft) {
      node.shadow = new NineSliceSprite({ texture: this.#soft, leftWidth: 22, rightWidth: 22, topHeight: 22, bottomHeight: 22 });
      node.holder.addChildAt(node.shadow, 0);
    } else if (!wantsShadow && node.shadow) {
      node.shadow.destroy();
      node.shadow = undefined;
    }
    if (node.shadow) {
      node.shadow.tint = this.#theme.shadow;
      node.shadow.alpha = this.#theme.name === "dark" ? 0.55 : 0.22;
    }

    this.#syncLabel(node);
    this.#syncCaption(node);
    this.#syncBadge(node);
  }

  /** A round badge with the vote count; ringed when one of the votes is yours. */
  #syncBadge(node: ShapeNode): void {
    const voters = node.view.voters ?? [];
    const mine = voters.includes(this.voter);
    const key = voters.length > 0 ? `${voters.length}|${mine}|${this.#theme.name}` : "";
    if (key === node.badgeKey) return;
    node.badgeKey = key;
    node.badge?.destroy({ children: true });
    node.badge = undefined;
    if (!key) return;
    const badge = new Container();
    const g = new Graphics()
      .circle(0, 0, 15)
      .fill(0xdd2f6e)
      .stroke({ width: mine ? 3 : 2, color: mine ? 0xffd666 : 0xffffff });
    const text = new Text({ text: String(voters.length), resolution: 2, style: { fontFamily: FONT, fontSize: 14, fontWeight: "800", fill: 0xffffff } });
    text.anchor.set(0.5);
    badge.addChild(g, text);
    node.holder.addChild(badge);
    node.badge = badge;
    this.#placeBadge(node);
    node.pop = 0;
  }

  #placeBadge(node: ShapeNode): void {
    if (node.badge) node.badge.position.set(node.pose.w / 2 - 4, -node.pose.h / 2 + 4);
  }

  #stepPops(dtMs: number): void {
    for (const node of this.#nodes.values()) {
      if (node.pop === undefined) continue;
      node.pop += dtMs;
      const t = Math.min(1, node.pop / POP_MS);
      const s = t >= 1 ? 1 : 0.55 + 0.45 * springPop(t * 1.0);
      node.holder.scale.set(s, s);
      if (t >= 1) {
        node.pop = undefined;
        node.holder.scale.set(1, 1);
      }
    }
  }

  /** Laser trails: a wide soft glow under a bright core, fading along its length. */
  #drawLaser(): void {
    const g = this.#laser;
    const now = performance.now();
    for (const peer of this.#peers.list()) {
      if (peer.presence.laser && peer.shown) this.addLaserPoint(peer.clientId, peer.shown, peer.presence.color);
    }
    if (this.#trails.size === 0) {
      if (g.children.length > 0 || this.#laserWasDrawn) g.clear();
      this.#laserWasDrawn = false;
      return;
    }
    g.clear();
    this.#laserWasDrawn = true;
    const zoom = this.viewport.zoom;
    for (const [key, trail] of this.#trails) {
      while (trail.points.length > 0 && now - (trail.points[0]?.at ?? now) > LASER_MS) trail.points.shift();
      if (trail.points.length === 0) {
        this.#trails.delete(key);
        continue;
      }
      const pts = trail.points;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        if (!a || !b) continue;
        const life = 1 - (now - b.at) / LASER_MS;
        const w = (2 + 8 * life) / zoom;
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: w * 2.6, color: 0xff2d2d, alpha: 0.12 * life, cap: "round" });
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: w, color: 0xff4d4d, alpha: 0.85 * life, cap: "round" });
      }
      const head = pts[pts.length - 1];
      if (head) {
        g.circle(head.x, head.y, 14 / zoom).fill({ color: 0xff2d2d, alpha: 0.25 });
        g.circle(head.x, head.y, 6 / zoom).fill(0xffe1e1);
      }
    }
  }

  #syncLabel(node: ShapeNode): void {
    const view = node.view;
    const text = view.kind === "arrow" || view.kind === "frame" || view.kind === "path" ? undefined : view.label;
    if (!text) {
      node.label?.destroy();
      node.label = undefined;
      return;
    }
    const big = view.kind === "text";
    const comment = view.kind === "comment";
    const fill = big || comment ? this.#theme.ink : view.kind === "diamond" ? labelColor(displayFill(view.fill, this.#theme)) : labelColor(displayFill(view.fill, this.#theme));
    const wrap = comment ? 220 : Math.max(24, view.w - 22);
    const style = {
      fontFamily: FONT,
      fontSize: big ? 24 : comment ? 14 : 15,
      fontWeight: big ? ("700" as const) : ("600" as const),
      lineHeight: big ? 30 : comment ? 19 : 19,
      fill,
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: wrap,
      align: view.kind === "ellipse" || view.kind === "diamond" ? ("center" as const) : ("left" as const),
    };
    if (!node.label) {
      node.label = new Text({ text, resolution: 2, style });
      node.holder.addChild(node.label);
    } else {
      if (node.label.text !== text) node.label.text = text;
      Object.assign(node.label.style, style);
    }
    node.label.visible = node.id !== this.#hiddenLabel;
  }

  /** Frame titles and comment authors. */
  #syncCaption(node: ShapeNode): void {
    const view = node.view;
    const text = view.kind === "frame" ? (view.label ?? "Frame") : view.kind === "comment" ? (view.author ?? "") : "";
    if (!text) {
      node.caption?.destroy();
      node.caption = undefined;
      return;
    }
    const style =
      view.kind === "frame"
        ? { fontFamily: FONT, fontSize: 14, fontWeight: "700" as const, fill: this.#theme.muted }
        : { fontFamily: FONT, fontSize: 11, fontWeight: "700" as const, fill: this.#theme.muted };
    if (!node.caption) {
      node.caption = new Text({ text, resolution: 2, style });
      node.holder.addChild(node.caption);
    } else {
      if (node.caption.text !== text) node.caption.text = text;
      Object.assign(node.caption.style, style);
    }
  }

  /** Position, size and rotate a node from its pose; redraw vector bodies if needed. */
  #place(node: ShapeNode): void {
    const { x, y, w, h, rotation, alpha } = node.pose;
    const view = node.view;
    const holder = node.holder;
    holder.alpha = alpha;
    if (view.kind === "arrow") {
      holder.position.set(0, 0);
      holder.rotation = 0;
      this.#arrowsDirty = true;
      return;
    }
    holder.position.set(x + w / 2, y + h / 2);
    holder.rotation = rotation;
    const left = -w / 2;
    const top = -h / 2;
    const body = node.body;
    if (body instanceof Graphics) this.#drawVector(node, body, w, h);
    else if (body) {
      body.position.set(left, top);
      body.setSize(w, h);
    }
    if (node.shadow) {
      node.shadow.position.set(left - 8, top - 3);
      node.shadow.setSize(w + 16, h + 18);
    }
    const label = node.label;
    if (label) {
      if (view.kind === "comment") label.position.set(left + 44, top + 22);
      else if (view.kind === "ellipse" || view.kind === "diamond") {
        label.style.wordWrapWidth = Math.max(24, (view.kind === "diamond" ? w * 0.6 : w * 0.72) - 8);
        label.position.set(-label.width / 2, -label.height / 2);
      } else {
        if (label.style.wordWrapWidth !== Math.max(24, w - 22)) label.style.wordWrapWidth = Math.max(24, w - 22);
        label.position.set(left + (view.kind === "text" ? 2 : 11), top + (view.kind === "text" ? 2 : 10));
      }
    }
    this.#placeBadge(node);
    const caption = node.caption;
    if (caption) {
      if (view.kind === "frame") caption.position.set(left + 2, top - FRAME_TITLE_H + 6);
      else caption.position.set(left + 44, top + 4);
    }
  }

  /** Draw diamonds, frames, pen strokes and comments in the holder's local frame. */
  #drawVector(node: ShapeNode, g: Graphics, w: number, h: number): void {
    const view = node.view;
    const key = `${view.kind}|${w.toFixed(1)}|${h.toFixed(1)}|${view.fill}|${view.points?.length ?? 0}|${view.label ?? ""}|${this.#theme.name}`;
    if (key === node.drawn) return;
    node.drawn = key;
    g.clear();
    const left = -w / 2;
    const top = -h / 2;
    const fill = displayFill(view.fill, this.#theme);
    switch (view.kind) {
      case "diamond":
        g.poly([0, top, w / 2, 0, 0, h / 2, left, 0]).fill(fill);
        return;
      case "frame":
        g.roundRect(left, top, w, h, 14)
          .fill({ color: fill, alpha: this.#theme.name === "dark" ? 0.16 : 0.12 })
          .stroke({ width: 1.5, color: fill, alpha: 0.55 });
        return;
      case "path": {
        const pts = parsePath(view.points, w, h);
        const color = inkColor(view.fill, this.#theme);
        if (pts.length === 1 && pts[0]) g.circle(pts[0].x, pts[0].y, 2.2).fill(color);
        else if (pts.length > 1) {
          const [first, ...rest] = pts;
          if (!first) return;
          g.moveTo(first.x, first.y);
          for (const p of rest) g.lineTo(p.x, p.y);
          g.stroke({ width: 3.5, color, cap: "round", join: "round" });
        }
        return;
      }
      case "comment": {
        // A pin (initial inside) and, when there's text, a card beside it.
        g.circle(left + 16, top + 16, 15).fill(fill).stroke({ width: 2.5, color: 0xffffff });
        g.moveTo(left + 5, top + 26).lineTo(left + 1, top + 33).lineTo(left + 12, top + 30).fill(fill);
        if (view.label) {
          const label = node.label;
          const cw = Math.max(140, (label?.width ?? 120) + 26);
          const ch = (label?.height ?? 18) + 34;
          g.roundRect(left + 34, top - 2, cw, ch, 12)
            .fill(this.#theme.paper)
            .stroke({ width: 1, color: this.#theme.line });
        }
        return;
      }
      default:
        g.rect(left, top, w, h).fill(fill);
    }
  }

  /** Arrows follow the shapes they're attached to (including mid-animation). */
  #drawArrows(): void {
    this.#arrowsDirty = false;
    for (const id of this.#arrows) {
      const node = this.#nodes.get(id);
      if (!node || !(node.body instanceof Graphics)) continue;
      const g = node.body;
      const view = this.lookup(id);
      if (!view) continue;
      const { a, b } = arrowEnds(view, this.lookup);
      g.clear();
      const color = inkColor(view.fill, this.#theme);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const head = 13;
      const tail = { x: b.x - Math.cos(angle) * head * 0.8, y: b.y - Math.sin(angle) * head * 0.8 };
      g.moveTo(a.x, a.y).lineTo(tail.x, tail.y).stroke({ width: 2.5, color, cap: "round" });
      g.poly([
        b.x,
        b.y,
        b.x - Math.cos(angle - 0.42) * head,
        b.y - Math.sin(angle - 0.42) * head,
        b.x - Math.cos(angle + 0.42) * head,
        b.y - Math.sin(angle + 0.42) * head,
      ]).fill(color);
      this.#placeArrowLabel(node, a, b);
    }
  }

  #placeArrowLabel(node: ShapeNode, a: Point, b: Point): void {
    const text = node.view.label;
    if (!text) {
      node.label?.destroy();
      node.label = undefined;
      return;
    }
    const style = { fontFamily: FONT, fontSize: 13, fontWeight: "600" as const, fill: this.#theme.ink };
    if (!node.label) {
      node.label = new Text({ text, resolution: 2, style });
      node.holder.addChild(node.label);
    } else if (node.label.text !== text) node.label.text = text;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const g = node.body;
    if (g instanceof Graphics) {
      g.roundRect(mid.x - node.label.width / 2 - 8, mid.y - node.label.height / 2 - 4, node.label.width + 16, node.label.height + 8, 10)
        .fill(this.#theme.paper)
        .stroke({ width: 1, color: this.#theme.line });
    }
    node.label.position.set(mid.x - node.label.width / 2, mid.y - node.label.height / 2);
  }

  #stepFloaters(dtMs: number): void {
    for (let i = this.#floaters.length - 1; i >= 0; i--) {
      const f = this.#floaters[i];
      if (!f) continue;
      f.elapsed += dtMs;
      const t = Math.min(1, f.elapsed / FLOAT_MS);
      const rise = easeOutCubic(t);
      f.text.position.set(f.start.x + f.drift * rise + Math.sin(t * 9) * 6, f.start.y - 120 * rise);
      f.text.scale.set(t < 0.15 ? 0.4 + (t / 0.15) * 0.8 : 1.2 - t * 0.2);
      f.text.alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      if (t >= 1) {
        f.text.destroy();
        this.#floaters.splice(i, 1);
      }
    }
  }

  #drawCursors(v: Viewport): void {
    const live = new Set<string>();
    for (const peer of this.#peers.list()) {
      if (!peer.shown) continue;
      live.add(peer.clientId);
      const view = this.#cursorFor(peer);
      const screen = worldToScreen(v, peer.shown);
      view.root.position.set(screen.x, screen.y);
      const chat = peer.presence.chat ?? "";
      if (chat !== view.chatText) {
        view.chat?.destroy({ children: true });
        view.chat = chat ? buildChat(chat, view.color) : undefined;
        if (view.chat) view.root.addChild(view.chat);
        view.chatText = chat;
      }
    }
    for (const [id, view] of this.#cursors) {
      if (live.has(id)) continue;
      view.root.destroy({ children: true });
      this.#cursors.delete(id);
    }
  }

  #cursorFor(peer: Peer): CursorView {
    const existing = this.#cursors.get(peer.clientId);
    if (existing && existing.name === peer.presence.name && existing.color === peer.presence.color) return existing;
    existing?.root.destroy({ children: true });
    const view = buildCursor(peer.presence.name, peer.presence.color);
    this.#cursorLayer.addChild(view.root);
    this.#cursors.set(peer.clientId, view);
    return view;
  }

  #outline(g: Graphics, s: ShapeView): void {
    if (s.kind === "arrow") {
      const { a, b } = arrowEnds(s, this.lookup);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      return;
    }
    const pts = corners(s);
    g.poly(pts.flatMap((p) => [p.x, p.y]));
  }

  /** Other people's selections, outlined in their color. */
  #drawRemoteSelections(g: Graphics): void {
    const width = 2 / this.viewport.zoom;
    for (const peer of this.#peers.list()) {
      let any = false;
      for (const id of peer.presence.selection.slice(0, MAX_OUTLINES)) {
        const s = this.lookup(id);
        if (!s) continue;
        any = true;
        this.#outline(g, s);
      }
      if (any) g.stroke({ width, color: peer.presence.color, alpha: 0.9 });
    }
  }

  #drawOverlay(selection: ReadonlySet<NodeId>): void {
    this.#overlayDirty = false;
    const g = this.#overlay;
    const zoom = this.viewport.zoom;
    const theme = this.#theme;
    g.clear();
    this.#drawRemoteSelections(g);
    const stroke = { width: 1.5 / zoom, color: theme.selection };

    const target = this.#attachTarget === undefined ? undefined : this.lookup(this.#attachTarget);
    if (target) {
      this.#outline(g, target);
      g.stroke({ width: 3 / zoom, color: theme.selection, alpha: 0.5 });
    }

    const selected: ShapeView[] = [];
    for (const id of selection) {
      const view = this.lookup(id);
      if (view) selected.push(view);
    }
    if (selected.length > 0 && selected.length <= MAX_OUTLINES) {
      for (const s of selected) this.#outline(g, s);
      g.stroke(stroke);
    }

    if (this.#showHandles && selected.length > 0) {
      const size = 9 / zoom;
      const knob = (p: Point, round = false): void => {
        if (round) g.circle(p.x, p.y, size / 1.6);
        else g.roundRect(p.x - size / 2, p.y - size / 2, size, size, 2 / zoom);
        g.fill(0xffffff).stroke({ width: 1.5 / zoom, color: theme.selection });
      };
      const only = selected.length === 1 ? selected[0] : undefined;
      if (only?.kind === "arrow") {
        const { a, b } = arrowEnds(only, this.lookup);
        knob(a, true);
        knob(b, true);
      } else if (only) {
        const handles = handlePositions(only, only.rotation ?? 0, zoom);
        const top = handles.find((h) => h.id === "n");
        const rot = handles.find((h) => h.id === "rotate");
        if (top && rot && only.kind !== "comment") {
          g.moveTo(top.p.x, top.p.y).lineTo(rot.p.x, rot.p.y).stroke(stroke);
        }
        for (const h of handles) {
          if (only.kind === "comment") continue;
          if (h.id === "rotate") knob(h.p, true);
          else knob(h.p);
        }
      } else {
        const bounds = boundsOf(selected.map((s) => visualBounds(s, this.lookup)));
        if (bounds) {
          const pad = 4 / zoom;
          g.rect(bounds.x - pad, bounds.y - pad, bounds.w + pad * 2, bounds.h + pad * 2).stroke({ ...stroke, alpha: 0.6 });
          for (const h of handlePositions(bounds, 0, zoom)) if (h.id !== "rotate") knob(h.p);
        }
      }
    }

    const qc = this.#quickConnect === undefined ? undefined : this.lookup(this.#quickConnect);
    if (qc) {
      for (const { p } of quickConnectPoints(qc, zoom)) {
        g.circle(p.x, p.y, 11 / zoom).fill({ color: theme.selection, alpha: 0.95 }).stroke({ width: 2 / zoom, color: 0xffffff });
        const arm = 5 / zoom;
        g.moveTo(p.x - arm, p.y).lineTo(p.x + arm, p.y).moveTo(p.x, p.y - arm).lineTo(p.x, p.y + arm).stroke({ width: 2 / zoom, color: 0xffffff, cap: "round" });
      }
    }

    for (const guide of this.#guides) {
      g.moveTo(guide.x1, guide.y1).lineTo(guide.x2, guide.y2);
    }
    if (this.#guides.length > 0) g.stroke({ width: 1 / zoom, color: theme.guide });

    const draft = this.#draft;
    if (draft?.kind === "box") {
      const r = draft.rect;
      if (draft.shape === "ellipse") g.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2);
      else if (draft.shape === "diamond") g.poly([r.x + r.w / 2, r.y, r.x + r.w, r.y + r.h / 2, r.x + r.w / 2, r.y + r.h, r.x, r.y + r.h / 2]);
      else g.roundRect(r.x, r.y, r.w, r.h, 8 / zoom);
      g.fill({ color: theme.selection, alpha: 0.08 }).stroke({ ...stroke, alpha: 0.9 });
    } else if (draft?.kind === "arrow") {
      g.moveTo(draft.a.x, draft.a.y).lineTo(draft.b.x, draft.b.y).stroke({ width: 2.5, color: theme.selection, cap: "round" });
      g.circle(draft.b.x, draft.b.y, 4 / zoom).fill(theme.selection);
    } else if (draft?.kind === "path" && draft.points.length > 1) {
      const [first, ...rest] = draft.points;
      if (first) {
        g.moveTo(first.x, first.y);
        for (const p of rest) g.lineTo(p.x, p.y);
        g.stroke({ width: 3.5, color: inkColor(draft.color, theme), cap: "round", join: "round" });
      }
    }

    const m = this.#marquee;
    if (m) g.rect(m.x, m.y, m.w, m.h).fill({ color: theme.selection, alpha: 0.08 }).stroke(stroke);
  }
}

const samePose = (a: Pose, b: Pose): boolean => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.rotation === b.rotation;

/** Pen points in the holder's local frame (centered on the box). */
function parsePath(points: string | undefined, w: number, h: number): Point[] {
  if (!points) return [];
  const out: Point[] = [];
  for (const pair of points.split(" ")) {
    const comma = pair.indexOf(",");
    const x = Number(pair.slice(0, comma));
    const y = Number(pair.slice(comma + 1));
    if (comma > 0 && Number.isFinite(x) && Number.isFinite(y)) out.push({ x: (x - 0.5) * w, y: (y - 0.5) * h });
  }
  return out;
}
