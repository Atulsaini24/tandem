import { Application, Container, Graphics, Sprite, Text, Texture, TilingSprite } from "pixi.js";
import type { NodeId, ShapeView } from "@canvas/doc";
import { boundsOf, type Rect } from "./hit-test";
import type { Peer, Peers } from "./peers";
import type { Scene } from "./scene";
import { clampZoom, panBy, screenToWorld, stepZoom, worldToScreen, type Point, type Viewport } from "./viewport";

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
  #grid: TilingSprite | undefined;
  #circle: Texture | undefined;
  #dot: Texture | undefined;
  #zoomTarget = 1;
  #zoomAnchor: Point = { x: 0, y: 0 };
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
    this.#world.addChild(this.#layer, this.#overlay);
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
    this.viewport = panBy(this.viewport, dx, dy);
    this.#overlayDirty = true;
  }

  /** Animated zoom by `factor` around a screen point. */
  zoomBy(factor: number, anchor: Point): void {
    this.setZoomTarget(this.#zoomTarget * factor, anchor);
  }

  setZoomTarget(zoom: number, anchor: Point): void {
    this.#zoomTarget = clampZoom(zoom);
    this.#zoomAnchor = anchor;
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
    if (this.viewport.zoom !== this.#zoomTarget) {
      this.viewport = stepZoom(this.viewport, this.#zoomTarget, this.#zoomAnchor, dtMs);
      this.#overlayDirty = true;
    }
    const v = this.viewport;
    this.#world.position.set(v.x, v.y);
    this.#world.scale.set(v.zoom);
    this.#updateGrid(v);
    this.#syncScene();

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

    for (const id of scene.dirty) {
      const view = scene.get(id);
      let sprite = this.#sprites.get(id);
      if (!view) {
        if (sprite) {
          this.#layer.removeChild(sprite);
          sprite.destroy();
          this.#sprites.delete(id);
        }
        continue;
      }
      if (!sprite) {
        sprite = new Sprite();
        this.#sprites.set(id, sprite);
        this.#layer.addChild(sprite);
      }
      this.#applyView(sprite, view);
    }
    scene.dirty.clear();
    this.#overlayDirty = true;

    if (scene.orderDirty) {
      this.#layer.removeChildren();
      for (const id of scene.ids()) {
        const sprite = this.#sprites.get(id);
        if (sprite) this.#layer.addChild(sprite);
      }
      scene.orderDirty = false;
    }
  }

  #applyView(sprite: Sprite, view: ShapeView): void {
    const texture = view.kind === "ellipse" && this.#circle ? this.#circle : Texture.WHITE;
    if (sprite.texture !== texture) sprite.texture = texture;
    sprite.tint = view.fill;
    sprite.position.set(view.x, view.y);
    sprite.setSize(view.w, view.h);
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
