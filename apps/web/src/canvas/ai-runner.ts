import type { NodeId, ShapeProps } from "@canvas/doc";
import {
  COLORS,
  OllamaError,
  headerRect,
  CHART_SCHEMA,
  SCENE_SCHEMA,
  buildChartMessages,
  buildSceneMessages,
  layoutDiagram,
  runDeck,
  runJson,
  runDiagram,
  runInsight,
  stagingRect,
  type DiagramKind,
  type DiagramNode,
  type NodeShape,
  itemRect,
  runAssistant,
  titleRect,
  type AiEvent,
  type AiRequest,
  type Point,
  type Rect,
} from "@canvas/ai";
import { useUiStore } from "../state/ui-store";
import { chatOptions } from "./ai-models";
import { parseChart } from "./charts";
import { parseScene } from "./scenes";
import { hashTheme, SLIDE_H, SLIDE_THEMES, SLIDE_W, type SlideThemeName } from "./slides";
import { boundsOf, visualBounds } from "./geometry";
import { INK, NOTE_COLORS } from "./templates";
import type { Editor } from "./editor";

/** The model the user picked, with the right options for it. */
const llm = (signal: AbortSignal) => ({ ...chatOptions(useUiStore.getState().aiModel), signal });
const TITLE_FILL = 0x111318;
const NOTE_FILL = COLORS.yellow;

/**
 * Turns the assistant's streamed board events into canvas edits.
 *
 * Every edit of one run shares one undo group (Ctrl+Z removes the whole result) and
 * syncs to collaborators like any edit. Cards are placed as each one finishes streaming,
 * with a fade/glide, so the board fills in while the model is still writing.
 */
export class AiRunner {
  readonly #editor: Editor;
  #abort: AbortController | undefined;

  constructor(editor: Editor) {
    this.#editor = editor;
  }

  get running(): boolean {
    return this.#abort !== undefined;
  }

  cancel(): void {
    this.#abort?.abort();
  }

  /** Brainstorm a new board from a prompt, placed in the visible area. */
  generate(prompt: string): Promise<void> {
    return this.#run({ mode: "generate", prompt }, this.#freeSpot(), []);
  }

  /** Sort the selected labelled shapes into columns (they move; nothing is duplicated). */
  organize(prompt: string): Promise<void> {
    const notes = this.organizable();
    if (notes.length < 2) {
      useUiStore.getState().setAi({ status: "error", message: "Select at least 2 shapes with text to organize." });
      return Promise.resolve();
    }
    const origin = { x: Math.min(...notes.map((n) => n.x)), y: Math.min(...notes.map((n) => n.y)) };
    return this.#run({ mode: "organize", prompt, notes: notes.map((n) => n.label ?? "") }, origin, notes.map((n) => n.id));
  }

  /**
   * Draw a flowchart or mind map. Nodes appear in a loose grid as they stream in, arrows
   * connect them as edges arrive, and when the model is done everything glides into a
   * proper layout (the arrows follow, since they're attached). One undo step.
   */
  async diagram(kind: DiagramKind, prompt: string): Promise<void> {
    if (this.#abort) return;
    const abort = new AbortController();
    this.#abort = abort;
    const editor = this.#editor;
    const group = editor.beginGroup();
    const origin = this.#freeSpot(kind === "mindmap" ? 2200 : 1700, kind === "mindmap" ? 1300 : 700);
    const ids = new Map<string, NodeId>();
    const nodes: DiagramNode[] = [];
    const edges: Array<{ from: string; to: string }> = [];
    let titleId: NodeId | undefined;
    let items = 0;
    useUiStore.getState().setAi({ status: "thinking", mode: "diagram", items: 0, startedAt: Date.now(), message: "", tokensPerSecond: 0 });
    try {
      for await (const event of runDiagram(kind, prompt, llm(abort.signal))) {
        if (event.type === "title") {
          titleId = editor.aiCreate({ kind: "text", x: origin.x, y: origin.y - 70, w: 640, h: 40, fill: INK, label: event.title }, group);
          const current = useUiStore.getState().title;
          if (!current || current === "Untitled board") editor.setTitle(event.title);
        } else if (event.type === "node") {
          const rect = stagingRect(origin, event.index, event.shape);
          const root = kind === "mindmap" && event.index === 0;
          const props: ShapeProps = root
            ? { kind: "ellipse", ...rect, w: 260, h: 120, fill: INK, label: event.label }
            : { kind: shapeKind(event.shape), ...rect, fill: shapeFill(event.shape), label: event.label };
          ids.set(event.id, editor.aiCreate(props, group));
          nodes.push({ id: event.id, shape: event.shape });
          items += 1;
          useUiStore.getState().setAi({ status: "writing", items });
        } else if (event.type === "edge") {
          const from = ids.get(event.from);
          const to = ids.get(event.to);
          if (!from || !to) continue;
          edges.push({ from: event.from, to: event.to });
          editor.aiCreate({ kind: "arrow", x: 0, y: 0, w: 1, h: 1, fill: INK, points: "0,0 1,1", from, to, ...(event.label ? { label: event.label } : {}) }, group);
        } else {
          // Final layout: glide every node into place.
          const rects = layoutDiagram(kind, nodes, edges, origin);
          const branchFill = kind === "mindmap" ? mindmapColors(nodes, edges) : new Map<string, number>();
          for (const [slug, rect] of rects) {
            const id = ids.get(slug);
            if (!id) continue;
            editor.aiMove(id, rect, group);
            const fill = branchFill.get(slug);
            if (fill !== undefined) editor.updateShapes([{ id, patch: { fill } }], group);
          }
          const all = boundsOf([...rects.values()]);
          if (titleId && all) editor.aiMove(titleId, { x: all.x, y: all.y - 80, w: Math.max(320, Math.min(all.w, 900)), h: 40 }, group);
          if (all) this.#show({ x: all.x, y: all.y - 90, w: all.w, h: all.h + 90 });
          useUiStore.getState().setAi({
            status: "done",
            items: event.nodes,
            finishedAt: Date.now(),
            message: `${event.edges} connection${event.edges === 1 ? "" : "s"}${event.rejected > 0 ? ` · ${event.rejected} invalid suggestion${event.rejected === 1 ? "" : "s"} ignored` : ""}`,
            ...(event.tokensPerSecond === undefined ? {} : { tokensPerSecond: event.tokensPerSecond }),
          });
        }
      }
    } catch (error) {
      this.#fail(error, abort);
    } finally {
      this.#abort = undefined;
    }
  }

  /**
   * Read the board (or the selection) and write a summary, the key points and what's
   * missing, as a frame of notes next to the board. The summary also shows in the panel.
   */
  async insight(prompt: string): Promise<void> {
    if (this.#abort) return;
    const editor = this.#editor;
    const selected = editor.selected();
    const source = selected.length > 0 ? editor.dragSet(useUiStore.getState().selection) : editor.scene.ordered();
    const texts = source.flatMap((s) => (s.label?.trim() ? [s.kind === "frame" ? `Section: ${s.label}` : s.kind === "comment" ? `Comment: ${s.label}` : s.label] : []));
    if (texts.length === 0) {
      useUiStore.getState().setAi({ status: "error", message: "There's no text on this board to summarize yet." });
      return;
    }
    const abort = new AbortController();
    this.#abort = abort;
    const group = editor.beginGroup();
    const board = boundsOf(source.map((s) => visualBounds(s, editor.lookup))) ?? { x: 0, y: 0, w: 0, h: 0 };
    const x = board.x + board.w + 140;
    const y = board.y;
    const W = 760;
    const half = (W - 72) / 2;
    let frameId: NodeId | undefined;
    let height = 240;
    const grow = (bottom: number): void => {
      if (!frameId || bottom + 30 <= y + height) return;
      height = bottom + 30 - y;
      editor.updateShapes([{ id: frameId, patch: { h: height } }], group);
    };
    let items = 0;
    useUiStore.getState().setAi({ status: "thinking", mode: "insight", items: 0, startedAt: Date.now(), message: "", summary: "", tokensPerSecond: 0 });
    try {
      for await (const event of runInsight(prompt, texts, llm(abort.signal))) {
        if (event.type === "summary") {
          frameId = editor.aiCreate({ kind: "frame", x, y, w: W, h: height, fill: 0x7b55e7, label: "✦ AI summary" }, group);
          editor.aiCreate({ kind: "rect", x: x + 24, y: y + 24, w: W - 48, h: 120, fill: NOTE_COLORS.purple, label: event.text }, group);
          editor.aiCreate({ kind: "rect", x: x + 24, y: y + 168, w: half, h: 44, fill: INK, label: "Key points" }, group);
          editor.aiCreate({ kind: "rect", x: x + 48 + half, y: y + 168, w: half, h: 44, fill: 0xdd4f78, label: "What's missing" }, group);
          grow(y + 212);
          useUiStore.getState().setAi({ status: "writing", summary: event.text });
        } else if (event.type === "point" || event.type === "missing") {
          const column = event.type === "point" ? 0 : 1;
          const rect = { x: x + 24 + column * (24 + half), y: y + 228 + event.index * 98, w: half, h: 84 };
          editor.aiCreate({ kind: "rect", ...rect, fill: column === 0 ? NOTE_COLORS.blue : NOTE_COLORS.pink, label: event.text }, group);
          grow(rect.y + rect.h);
          items += 1;
          useUiStore.getState().setAi({ status: "writing", items });
        } else {
          useUiStore.getState().setAi({
            status: "done",
            items,
            finishedAt: Date.now(),
            message: event.rejected > 0 ? `${event.rejected} invalid line${event.rejected === 1 ? "" : "s"} ignored` : "",
            ...(event.tokensPerSecond === undefined ? {} : { tokensPerSecond: event.tokensPerSecond }),
          });
          this.#show({ x, y: y - 40, w: W, h: height + 40 });
        }
      }
    } catch (error) {
      this.#fail(error, abort);
    } finally {
      this.#abort = undefined;
    }
  }

  #fail(error: unknown, abort: AbortController): void {
    if (abort.signal.aborted) {
      useUiStore.getState().setAi({ status: "cancelled", finishedAt: Date.now(), message: "Stopped. What was placed stays (Ctrl+Z removes it)." });
    } else {
      const message = error instanceof OllamaError ? error.message : `Something went wrong: ${String(error)}`;
      useUiStore.getState().setAi({ status: "error", finishedAt: Date.now(), message });
    }
  }

  /** Make one designed chart card: KPIs, the plot and the insight, all in one shape. */
  async chart(prompt: string): Promise<void> {
    if (this.#abort) return;
    const abort = new AbortController();
    this.#abort = abort;
    const editor = this.#editor;
    const ui = useUiStore.getState();
    ui.setAi({ status: "thinking", mode: "chart", items: 0, startedAt: Date.now(), message: "", tokensPerSecond: 0 });
    try {
      const { value, tokensPerSecond } = await runJson(buildChartMessages(prompt), CHART_SCHEMA, llm(abort.signal), () => useUiStore.getState().setAi({ status: "writing" }));
      const data = JSON.stringify(value);
      const spec = parseChart(data);
      if (!spec) throw new Error("The model didn't return usable chart data. Try rephrasing.");
      const w = 860;
      const h = spec.kpis.length > 0 ? 600 : 500;
      const at = this.#freeSpot(w, h);
      const id = editor.aiCreate({ kind: "chart", x: at.x, y: at.y, w, h, fill: 0x2f63ff, data, label: spec.title }, editor.beginGroup());
      useUiStore.getState().reveal([id]);
      useUiStore.getState().setAi({ status: "done", items: 1, finishedAt: Date.now(), message: `${spec.type} chart · ${spec.labels.length} points${spec.series.length > 1 ? ` · ${spec.series.length} series` : ""}`, ...(tokensPerSecond === undefined ? {} : { tokensPerSecond }) });
      this.#show({ x: at.x, y: at.y - 20, w, h: h + 40 });
    } catch (error) {
      this.#fail(error, abort);
    } finally {
      this.#abort = undefined;
    }
  }

  /** Build an interactive 3D scene in a 3D card on the board. */
  async scene(prompt: string): Promise<void> {
    if (this.#abort) return;
    const abort = new AbortController();
    this.#abort = abort;
    const editor = this.#editor;
    useUiStore.getState().setAi({ status: "thinking", mode: "scene", items: 0, startedAt: Date.now(), message: "", tokensPerSecond: 0 });
    try {
      const { value, tokensPerSecond } = await runJson(buildSceneMessages(prompt), SCENE_SCHEMA, llm(abort.signal), () => useUiStore.getState().setAi({ status: "writing" }));
      const data = JSON.stringify(value);
      const spec = parseScene(data);
      if (!spec) throw new Error("The model didn't return a usable 3D scene. Try rephrasing.");
      const w = 960;
      const h = 600;
      const at = this.#freeSpot(w, h);
      editor.aiCreate({ kind: "scene3d", x: at.x, y: at.y, w, h, fill: 0x111318, data, label: spec.title || prompt.slice(0, 60) }, editor.beginGroup());
      useUiStore.getState().setAi({ status: "done", items: spec.objects.length, finishedAt: Date.now(), message: `3D scene · ${spec.objects.length} objects · double-click it to orbit`, ...(tokensPerSecond === undefined ? {} : { tokensPerSecond }) });
      this.#show({ x: at.x, y: at.y - 20, w, h: h + 40 });
    } catch (error) {
      this.#fail(error, abort);
    } finally {
      this.#abort = undefined;
    }
  }

  /**
   * A slide deck: each slide is a frame holding one designed slide (960×540), placed the
   * moment the model finishes it; then Present mode plays them with animated reveals.
   */
  async deck(prompt: string): Promise<void> {
    if (this.#abort) return;
    const abort = new AbortController();
    this.#abort = abort;
    const editor = this.#editor;
    const W = SLIDE_W;
    const H = SLIDE_H;
    const GAP = 120;
    const notes = editor.scene.ordered().flatMap((s) => (s.label?.trim() && s.kind !== "frame" && editor.selected().some((x) => x.id === s.id) ? [s.label] : []));
    const origin = this.#freeSpot(W * 2 + GAP, H);
    const group = editor.beginGroup();
    const frames: NodeId[] = [];
    const slides: Array<{ id: NodeId; data: Record<string, unknown> }> = [];
    let deckTitle = "";
    let theme = "";
    useUiStore.getState().setAi({ status: "thinking", mode: "deck", items: 0, startedAt: Date.now(), message: "", tokensPerSecond: 0 });
    try {
      for await (const event of runDeck(prompt, notes, llm(abort.signal))) {
        if (event.type === "title") {
          deckTitle = event.title || prompt.slice(0, 60);
          theme = SLIDE_THEMES.includes(event.theme as SlideThemeName) ? event.theme : hashTheme(deckTitle);
        } else if (event.type === "slide") {
          const x = origin.x + event.slide.index * (W + GAP);
          const y = origin.y;
          const data = { ...event.slide.raw, theme, deck: deckTitle, index: event.slide.index, total: 0 };
          const frame = editor.aiCreate({ kind: "frame", x, y, w: W, h: H, fill: 0x2f63ff, label: `${event.slide.index + 1}. ${event.slide.title}`.slice(0, 120) }, group);
          const id = editor.aiCreate({ kind: "slide", x, y, w: W, h: H, fill: 0x111318, data: JSON.stringify(data), label: event.slide.title }, group);
          frames.push(frame);
          slides.push({ id, data });
          useUiStore.getState().reveal([id]);
          editor.renderer.fitTo({ x: x - 40, y: y - 80, w: W + 80, h: H + 120 }, 40, 0, 1, 700, true);
          useUiStore.getState().setAi({ status: "writing", items: frames.length });
        } else if (event.type === "done") {
          // Now the deck size is known: number the slides "03 / 09".
          editor.updateShapes(
            slides.map((s) => ({ id: s.id, patch: { data: JSON.stringify({ ...s.data, total: slides.length }) } })),
            group,
          );
          useUiStore.getState().setAi({ status: "done", items: event.slides, finishedAt: Date.now(), message: "Playing it now in Present mode — arrows to move, Esc to stop", ...(event.tokensPerSecond === undefined ? {} : { tokensPerSecond: event.tokensPerSecond }) });
          if (frames.length > 0) {
            useUiStore.getState().setAi({ status: "done", result: { x: origin.x, y: origin.y - 40, w: frames.length * (W + GAP), h: H + 80 } });
            setTimeout(() => editor.startPresenting(frames), 600);
          }
        }
      }
    } catch (error) {
      this.#fail(error, abort);
    } finally {
      this.#abort = undefined;
    }
  }

  /** Selected shapes that have text, in reading order. */
  organizable() {
    const scene = this.#editor.scene;
    return [...useUiStore.getState().selection]
      .flatMap((id) => {
        const shape = scene.get(id);
        return shape?.label ? [shape] : [];
      })
      .sort((a, b) => a.y - b.y || a.x - b.x);
  }

  async #run(request: AiRequest, origin: Point, noteIds: readonly NodeId[]): Promise<void> {
    if (this.#abort) return;
    const ui = useUiStore.getState();
    const abort = new AbortController();
    this.#abort = abort;
    const group = this.#editor.beginGroup();
    const placed: Rect[] = [];
    const columnFill = new Map<number, number>();
    let items = 0;
    ui.setAi({ status: "thinking", mode: request.mode, items: 0, startedAt: Date.now(), message: "", tokensPerSecond: 0 });

    const place = (rect: Rect, props: Omit<ShapeProps, "x" | "y" | "w" | "h">): void => {
      placed.push(rect);
      this.#editor.aiCreate({ ...props, x: rect.x, y: rect.y, w: rect.w, h: rect.h }, group);
    };

    try {
      for await (const event of runAssistant(request, llm(abort.signal))) {
        this.#apply(event, origin, noteIds, group, place, placed, columnFill);
        if (event.type === "item") {
          items += 1;
          useUiStore.getState().setAi({ status: "writing", items });
        } else if (event.type === "done") {
          const notes: string[] = [];
          if (event.unplaced.length > 0) notes.push(`${event.unplaced.length} note${event.unplaced.length === 1 ? "" : "s"} left where they were`);
          if (event.rejected > 0) notes.push(`${event.rejected} invalid suggestion${event.rejected === 1 ? "" : "s"} ignored`);
          useUiStore.getState().setAi({
            status: "done",
            items,
            finishedAt: Date.now(),
            message: notes.join(" · "),
            ...(event.tokensPerSecond === undefined ? {} : { tokensPerSecond: event.tokensPerSecond }),
          });
        }
      }
      if (placed.length > 0) this.#show(bounds(placed));
    } catch (error) {
      if (abort.signal.aborted) {
        useUiStore.getState().setAi({ status: "cancelled", finishedAt: Date.now(), message: "Stopped. What was placed stays (Ctrl+Z removes it)." });
      } else {
        const message = error instanceof OllamaError ? error.message : `Something went wrong: ${String(error)}`;
        useUiStore.getState().setAi({ status: "error", finishedAt: Date.now(), message });
      }
    } finally {
      this.#abort = undefined;
    }
  }

  #apply(
    event: AiEvent,
    origin: Point,
    noteIds: readonly NodeId[],
    group: number,
    place: (rect: Rect, props: Omit<ShapeProps, "x" | "y" | "w" | "h">) => void,
    placed: Rect[],
    columnFill: Map<number, number>,
  ): void {
    switch (event.type) {
      case "title": {
        place(titleRect(origin), { kind: "rect", fill: TITLE_FILL, label: event.title });
        const current = useUiStore.getState().title;
        if (!current || current === "Untitled board") this.#editor.setTitle(event.title);
        return;
      }
      case "column": {
        const fill = COLORS[event.color];
        columnFill.set(event.column, fill);
        if (noteIds.length > 0) {
          place(headerRect(origin, event.column), { kind: "rect", fill, label: event.title });
          return;
        }
        // A detailed plan: every column is a frame (a page you can present), headed by its title.
        const r = richColumn(origin, event.column);
        const frame = this.#editor.aiCreate({ kind: "frame", x: r.x, y: r.y, w: r.w, h: r.h, fill, label: event.title }, group);
        this.#editor.engine.send({ type: "back", seq: this.#editor.engine.nextSeq(), ids: [frame], group });
        placed.push(r);
        return;
      }
      case "item": {
        if (noteIds.length === 0) {
          const rect = richItem(origin, event.column, event.index);
          const meta = [event.owner ? `👤 ${event.owner}` : "", event.due ? `📅 ${event.due}` : "", event.priority ? `${PRIORITY[event.priority]} ${event.priority}` : ""].filter(Boolean).join("  ·  ");
          const label = [event.text, event.detail ?? "", meta].filter(Boolean).join("\n\n");
          const pastel = PASTEL[event.column % PASTEL.length] ?? NOTE_FILL;
          place(rect, { kind: "rect", fill: pastel, label: label.slice(0, 480) });
          return;
        }
        const rect = itemRect(origin, event.column, event.index);
        const existing = event.source === undefined ? undefined : noteIds[event.source];
        if (existing) {
          // Organize: move the user's own note into place (keeps its id, color, history).
          placed.push(rect);
          this.#editor.aiMove(existing, rect, group);
        } else {
          place(rect, { kind: "rect", fill: event.source === undefined && noteIds.length > 0 ? NOTE_FILL : (columnFill.get(event.column) ?? NOTE_FILL), label: event.text });
        }
      }
    }
  }

  /**
   * Where a new result goes: empty space beside the board (never on top of existing
   * work), with the camera flying there first so you watch it stream in.
   */
  #freeSpot(w = 900, h = 620): Point {
    const editor = this.#editor;
    const spot = editor.freeSpot(w, h);
    if (editor.scene.size > 0) editor.renderer.fitTo({ x: spot.x - 40, y: spot.y - 100, w: w + 80, h: h + 140 }, 40, 0, 1, 800, true);
    return spot;
  }

  /** Frame the finished result and remember it, for the panel's "Show result". */
  #show(rect: Rect): void {
    this.#editor.fitTo(rect);
    useUiStore.getState().setAi({ status: useUiStore.getState().ai.status, result: rect });
  }
}

function bounds(rects: readonly Rect[]): Rect {
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function shapeKind(shape: NodeShape): ShapeProps["kind"] {
  if (shape === "start" || shape === "end") return "ellipse";
  if (shape === "decision") return "diamond";
  return "rect";
}

function shapeFill(shape: NodeShape): number {
  if (shape === "start") return NOTE_COLORS.green;
  if (shape === "end") return NOTE_COLORS.pink;
  if (shape === "decision" || shape === "topic") return NOTE_COLORS.yellow;
  return NOTE_COLORS.blue;
}

/** Mind maps: each main branch (and everything under it) gets its own color. */
function mindmapColors(nodes: readonly DiagramNode[], edges: ReadonlyArray<{ from: string; to: string }>): Map<string, number> {
  const palette = [NOTE_COLORS.blue, NOTE_COLORS.green, NOTE_COLORS.orange, NOTE_COLORS.purple, NOTE_COLORS.pink, NOTE_COLORS.yellow];
  const root = nodes[0]?.id;
  const fills = new Map<string, number>();
  if (!root) return fills;
  const branches = edges.filter((e) => e.from === root).map((e) => e.to);
  branches.forEach((branch, i) => {
    const color = palette[i % palette.length] ?? NOTE_COLORS.yellow;
    const stack = [branch];
    while (stack.length > 0) {
      const id = stack.pop();
      if (id === undefined || fills.has(id) || id === root) continue;
      fills.set(id, color);
      for (const e of edges) if (e.from === id) stack.push(e.to);
    }
  });
  return fills;
}

const PASTEL = [0xa9cdff, 0xffd666, 0xa8e6b4, 0xffadc8, 0xcdb8ff, 0xffc49b] as const;
const PRIORITY = { high: "🔴", medium: "🟠", low: "🟢" } as const;
const RICH = { width: 300, cardH: 168, gap: 18, colGap: 48, head: 70, pad: 22 } as const;

/** A detailed plan's column frame (tall enough for six cards). */
function richColumn(origin: Point, column: number): Rect {
  return {
    x: origin.x + column * (RICH.width + RICH.pad * 2 + RICH.colGap),
    y: origin.y + 90,
    w: RICH.width + RICH.pad * 2,
    h: RICH.head + 6 * (RICH.cardH + RICH.gap) + RICH.pad,
  };
}

function richItem(origin: Point, column: number, index: number): Rect {
  const c = richColumn(origin, column);
  return { x: c.x + RICH.pad, y: c.y + RICH.head - 30 + index * (RICH.cardH + RICH.gap), w: RICH.width, h: RICH.cardH };
}
