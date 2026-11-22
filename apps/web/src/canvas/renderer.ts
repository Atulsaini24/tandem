import { Application, Container, Graphics, Sprite, Text, Texture, TilingSprite } from "pixi.js";
import type { NodeId, ShapeView } from "@canvas/doc";
import { boundsOf, type Rect } from "./hit-test";
import type { Peer, Peers } from "./peers";
import type { Scene } from "./scene";
import { clampZoom, panBy, screenToWorld, stepZoom, worldToScreen, type Point, type Viewport } from "./viewport";

/** A sprite gliding between two states (time-travel transitions). */
interface Tween {
  readonly from: { x: number; y: number; w: number; h: number; alpha: number };
  readonly to: { x: number; y: number; w: number; h: number; alpha: number };
  elapsed: number;
  /** Destroy the sprite when the tween ends (it faded out of existence). */
  readonly dispose: boolean;
}

const TWEEN_MS = 320;

/** Dark text on light fills, white on dark ones (perceived luminance). */
function labelColor(fill: number): number {
  const r = (fill >> 16) & 0xff;
  const g = (fill >> 8) & 0xff;
  const b = fill & 0xff;
  return 0.299 * r + 0.587 * g + 0.114 * b > 165 ? 0x111318 : 0xffffff;
}
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

interface CursorView {
  readonly root: Container;
  readonly name: string;
  readonly color: number;
}

/** A remote cursor: arrow + name tag, drawn in screen space so it stays the same size at any zoom. */
function buildCursor(name: string, color: number): CursorView {
  const root = new Container();
  const arrow = new Graphics()
    .poly([0, 0, 0, 17, 4.6, 12.8, 7.6, 19.2, 10.4, 18, 7.4, 11.7, 13, 11.7])
    .fill(color)
    .stroke({ width: 1.5, color: 0xffffff, alignment: 0 });
  const label = new Text({
    text: name,
    style: { fontFamily: "Inter, Helvetica Neue, Arial, sans-serif", fontSize: 11, fontWeight: "700", fill: 0xffffff },
  });
  label.position.set(20, 19);
  const tag = new Graphics().roundRect(14, 16, label.width + 12, 18, 9).fill(color);
  root.addChild(arrow, tag, label);
  return { root, name, color };
}

const BACKGROUND = 0xf3f0e8;
const GRID_DOT = 0xc9c4b8;
const GRID_SPACING = 24;
const SELECTION = 0x2f63ff;
/** Above this many selected shapes, draw one bounding box instead of every outline. */
const MAX_OUTLINES = 300;

/**
 * Draws the Scene with PixiJS.
 *
 * Every shape is a Sprite of one shared texture (a white pixel or a white circle),
 * colored with `tint` and sized with scale. Same texture + same blend mode means
 * Pixi's batcher draws thousands of shapes in a handful of draw calls, and moving
 * a shape is a transform change, never a re-tessellation.
 */
export class Renderer {
  readonly app = new Application();
  readonly frameListeners = new Set<(dtMs: number) => void>();
  viewport: Viewport = { x: 0, y: 0, zoom: 1 };

  readonly #scene: Scene;
  readonly #getSelection: () => ReadonlySet<NodeId>;
  readonly #peers: Peers;
  readonly #cursorLayer = new Container();
  readonly #cursors = new Map<string, CursorView>();
  #peersVersion = -1;
  readonly #world = new Container();
  readonly #layer = new Container();
  readonly #overlay = new Graphics();
  readonly #sprites = new Map<NodeId, Sprite>();
  readonly #tweens = new Map<Sprite, Tween>();
  /** Labels live on their own layer above all shapes, positioned to follow their sprite. */
  readonly #labels = new Container();
  readonly #texts = new Map<NodeId, Text>();
  readonly #spriteIds = new WeakMap<Sprite, NodeId>();
  #grid: TilingSprite | undefined;
  #circle: Texture | undefined;
  #dot: Texture | undefined;
  #zoomTarget = 1;
  #zoomAnchor: Point = { x: 0, y: 0 };
  #flight: { from: Viewport; to: Viewport; elapsed: number } | undefined;
  #overlayDirty = true;
  #lastSelection: ReadonlySet<NodeId> | undefined;
  #marquee: Rect | undefined;

  constructor(scene: Scene, getSelection: () => ReadonlySet<NodeId>, peers: Peers) {
    this.#scene = scene;
    this.#getSelection = getSelection;
    this.#peers = peers;
  }

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: host,
      background: BACKGROUND,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio, 2),
      preference: "webgl",
    });
    host.appendChild(this.app.canvas);

    this.#circle = this.app.renderer.generateTexture({
      target: new Graphics().circle(128, 128, 128).fill(0xffffff),
      antialias: true,
    });
    this.#dot = this.app.renderer.generateTexture({
      target: new Graphics()
        .rect(0, 0, GRID_SPACING, GRID_SPACING)
        .fill({ color: BACKGROUND, alpha: 0 })
        .circle(GRID_SPACING / 2, GRID_SPACING / 2, 1.1)
        .fill(GRID_DOT),
      resolution: 2,
    });
    this.#grid = new TilingSprite({ texture: this.#dot, width: this.app.screen.width, height: this.app.screen.height });

    // No Pixi hit-testing: we do our own (see hit-test.ts).
    this.app.stage.eventMode = "none";
    this.#world.addChild(this.#layer, this.#labels, this.#overlay);
    // Cursors live above the world, in screen space.
    this.app.stage.addChild(this.#grid, this.#world, this.#cursorLayer);

    this.viewport = { x: this.app.screen.width / 2, y: this.app.screen.height / 2, zoom: 1 };
    this.app.ticker.add((ticker) => this.#frame(ticker.deltaMS));
  }

  get screen(): { width: number; height: number } {
    return { width: this.app.screen.width, height: this.app.screen.height };
  }

  screenToWorld(p: Point): Point {
    return screenToWorld(this.viewport, p);
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

  /**
   * Animate the camera so `rect` (world coordinates) fills the view, never zooming past
   * 100%. `insetRight` keeps it clear of a panel covering the right edge.
   */
  fitTo(rect: Rect, padding = 80, insetRight = 0): void {
    const { height } = this.screen;
    const width = Math.max(200, this.screen.width - insetRight);
    const zoom = clampZoom(Math.min(1, (width - padding * 2) / rect.w, (height - padding * 2) / rect.h));
    const target: Viewport = {
      zoom,
      x: width / 2 - (rect.x + rect.w / 2) * zoom,
      y: height / 2 - (rect.y + rect.h / 2) * zoom,
    };
    this.#flight = { from: this.viewport, to: target, elapsed: 0 };
    this.#zoomTarget = zoom;
  }

  #stepFlight(dtMs: number): void {
    const flight = this.#flight;
    if (!flight) return;
    flight.elapsed += dtMs;
    const t = easeOutCubic(Math.min(1, flight.elapsed / 650));
    const { from, to } = flight;
    // Zoom in log space; position follows so the motion reads as one camera move.
    const zoom = Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * t);
    this.viewport = { zoom, x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    this.#overlayDirty = true;
    if (flight.elapsed >= 650) this.#flight = undefined;
  }

  set marquee(rect: Rect | undefined) {
    this.#marquee = rect;
    this.#overlayDirty = true;
  }

  destroy(): void {
    this.frameListeners.clear();
    // Don't destroy textures wholesale: Texture.WHITE is a shared global.
    this.app.destroy({ removeView: true }, { children: true });
    this.#circle?.destroy(true);
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
    this.#peers.step(dtMs);
    this.#drawCursors(v);
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
      let sprite = this.#sprites.get(id);
      this.#syncLabel(id, view);
      if (!view) {
        if (!sprite) continue;
        this.#sprites.delete(id);
        if (animate) {
          this.#tween(sprite, { x: sprite.x, y: sprite.y, w: sprite.width, h: sprite.height, alpha: 0 }, true);
        } else {
          this.#tweens.delete(sprite);
          this.#layer.removeChild(sprite);
          sprite.destroy();
        }
        continue;
      }
      if (!sprite) {
        sprite = new Sprite();
        this.#sprites.set(id, sprite);
        this.#spriteIds.set(sprite, id);
        this.#layer.addChild(sprite);
        this.#applyView(sprite, view);
        if (animate) {
          sprite.alpha = 0;
          this.#tween(sprite, { x: view.x, y: view.y, w: view.w, h: view.h, alpha: 1 }, false);
        }
        continue;
      }
      if (animate) {
        this.#applyLook(sprite, view);
        this.#tween(sprite, { x: view.x, y: view.y, w: view.w, h: view.h, alpha: 1 }, false);
      } else {
        this.#applyView(sprite, view);
      }
    }
    scene.dirty.clear();
    this.#overlayDirty = true;

    if (scene.orderDirty) {
      this.#layer.removeChildren();
      for (const id of scene.ids()) {
        const sprite = this.#sprites.get(id);
        if (sprite) this.#layer.addChild(sprite);
      }
      // Shapes fading out of existence stay on screen (on top) until their tween ends.
      for (const [sprite, tween] of this.#tweens) if (tween.dispose) this.#layer.addChild(sprite);
      scene.orderDirty = false;
    }
  }

  #tween(sprite: Sprite, to: Tween["to"], dispose: boolean): void {
    this.#tweens.set(sprite, {
      from: { x: sprite.x, y: sprite.y, w: sprite.width, h: sprite.height, alpha: sprite.alpha },
      to,
      elapsed: 0,
      dispose,
    });
  }

  #stepTweens(dtMs: number): void {
    for (const [sprite, tween] of this.#tweens) {
      tween.elapsed += dtMs;
      const t = easeOutCubic(Math.min(1, tween.elapsed / TWEEN_MS));
      const { from, to } = tween;
      sprite.position.set(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
      sprite.setSize(from.w + (to.w - from.w) * t, from.h + (to.h - from.h) * t);
      sprite.alpha = from.alpha + (to.alpha - from.alpha) * t;
      this.#placeLabel(sprite);
      if (tween.elapsed < TWEEN_MS) continue;
      this.#tweens.delete(sprite);
      if (tween.dispose) {
        this.#layer.removeChild(sprite);
        sprite.destroy();
      }
    }
  }

  #applyView(sprite: Sprite, view: ShapeView): void {
    const running = this.#tweens.get(sprite);
    const sameTarget =
      running && !running.dispose && running.to.x === view.x && running.to.y === view.y && running.to.w === view.w && running.to.h === view.h;
    if (sameTarget) {
      // The worker confirming the position this sprite is already animating to: let the
      // animation finish instead of snapping to the end (AI cards fly in this way).
      this.#applyLook(sprite, view);
      return;
    }
    this.#tweens.delete(sprite); // a different direct update wins over the animation
    this.#applyLook(sprite, view);
    sprite.alpha = 1;
    sprite.position.set(view.x, view.y);
    sprite.setSize(view.w, view.h);
    this.#placeLabel(sprite);
  }

  /** Create, update or remove a shape's label. */
  #syncLabel(id: NodeId, view: ShapeView | undefined): void {
    let text = this.#texts.get(id);
    if (!view?.label) {
      if (text) {
        this.#labels.removeChild(text);
        text.destroy();
        this.#texts.delete(id);
      }
      return;
    }
    const fill = labelColor(view.fill);
    const wrap = Math.max(24, view.w - 22);
    if (!text) {
      text = new Text({
        text: view.label,
        resolution: 2,
        style: {
          fontFamily: "Inter, Helvetica Neue, Arial, sans-serif",
          fontSize: 15,
          fontWeight: "600",
          lineHeight: 19,
          fill,
          wordWrap: true,
          breakWords: true,
          wordWrapWidth: wrap,
        },
      });
      this.#texts.set(id, text);
      this.#labels.addChild(text);
    } else {
      if (text.text !== view.label) text.text = view.label;
      if (text.style.fill !== fill) text.style.fill = fill;
      if (text.style.wordWrapWidth !== wrap) text.style.wordWrapWidth = wrap;
    }
    const sprite = this.#sprites.get(id);
    text.position.set((sprite?.x ?? view.x) + 11, (sprite?.y ?? view.y) + 10);
  }

  /** Keep a label glued to its (possibly animating) sprite. */
  #placeLabel(sprite: Sprite): void {
    const id = this.#spriteIds.get(sprite);
    const text = id === undefined ? undefined : this.#texts.get(id);
    if (!text) return;
    text.position.set(sprite.x + 11, sprite.y + 10);
    text.alpha = sprite.alpha;
  }

  /** Texture and color only (geometry may be animated separately). */
  #applyLook(sprite: Sprite, view: ShapeView): void {
    const texture = view.kind === "ellipse" && this.#circle ? this.#circle : Texture.WHITE;
    if (sprite.texture !== texture) sprite.texture = texture;
    sprite.tint = view.fill;
  }

  #drawCursors(v: Viewport): void {
    const live = new Set<string>();
    for (const peer of this.#peers.list()) {
      if (!peer.shown) continue;
      live.add(peer.clientId);
      const view = this.#cursorFor(peer);
      const screen = worldToScreen(v, peer.shown);
      view.root.position.set(screen.x, screen.y);
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

  /** Other people's selections, outlined in their color. */
  #drawRemoteSelections(g: Graphics): void {
    const width = 2 / this.viewport.zoom;
    for (const peer of this.#peers.list()) {
      let any = false;
      for (const id of peer.presence.selection.slice(0, MAX_OUTLINES)) {
        const s = this.#scene.get(id);
        if (!s) continue;
        any = true;
        if (s.kind === "ellipse") g.ellipse(s.x + s.w / 2, s.y + s.h / 2, s.w / 2, s.h / 2);
        else g.rect(s.x, s.y, s.w, s.h);
      }
      if (any) g.stroke({ width, color: peer.presence.color, alpha: 0.9 });
    }
  }

  #drawOverlay(selection: ReadonlySet<NodeId>): void {
    this.#overlayDirty = false;
    const g = this.#overlay;
    g.clear();
    this.#drawRemoteSelections(g);
    const stroke = { width: 1.5 / this.viewport.zoom, color: SELECTION };

    const selected: ShapeView[] = [];
    for (const id of selection) {
      const view = this.#scene.get(id);
      if (view) selected.push(view);
    }
    if (selected.length > 0 && selected.length <= MAX_OUTLINES) {
      for (const s of selected) {
        if (s.kind === "ellipse") g.ellipse(s.x + s.w / 2, s.y + s.h / 2, s.w / 2, s.h / 2);
        else g.rect(s.x, s.y, s.w, s.h);
      }
      g.stroke(stroke);
    }
    const bounds = selected.length > 1 ? boundsOf(selected) : undefined;
    if (bounds) {
      const pad = 4 / this.viewport.zoom;
      g.rect(bounds.x - pad, bounds.y - pad, bounds.w + pad * 2, bounds.h + pad * 2).stroke({ ...stroke, alpha: 0.5 });
    }
    const m = this.#marquee;
    if (m) g.rect(m.x, m.y, m.w, m.h).fill({ color: SELECTION, alpha: 0.08 }).stroke(stroke);
  }
}
