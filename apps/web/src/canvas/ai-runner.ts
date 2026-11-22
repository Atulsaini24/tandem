import type { NodeId, ShapeProps } from "@canvas/doc";
import {
  COLORS,
  OllamaError,
  headerRect,
  itemRect,
  runAssistant,
  titleRect,
  type AiEvent,
  type AiRequest,
  type Point,
  type Rect,
} from "@canvas/ai";
import { useUiStore } from "../state/ui-store";
import type { Editor } from "./editor";

const OLLAMA_URL = (import.meta.env.VITE_OLLAMA_URL as string | undefined) ?? "http://localhost:11434";
const OLLAMA_MODEL = (import.meta.env.VITE_OLLAMA_MODEL as string | undefined) ?? "gemma3:4b";
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
      for await (const event of runAssistant(request, { url: OLLAMA_URL, model: OLLAMA_MODEL, signal: abort.signal })) {
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
      if (placed.length > 0) this.#editor.fitTo(bounds(placed));
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
      case "title":
        place(titleRect(origin), { kind: "rect", fill: TITLE_FILL, label: event.title });
        return;
      case "column": {
        const fill = COLORS[event.color];
        columnFill.set(event.column, fill);
        place(headerRect(origin, event.column), { kind: "rect", fill, label: event.title });
        return;
      }
      case "item": {
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

  /** Top-left of the visible area, with a margin: the board starts where the user is looking. */
  #freeSpot(): Point {
    const renderer = this.#editor.renderer;
    // The finished board may be wider than the view; fitTo() reframes it when done.
    const world = renderer.screenToWorld({ x: 80, y: 120 });
    return { x: Math.round(world.x), y: Math.round(world.y) };
  }
}

function bounds(rects: readonly Rect[]): Rect {
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
