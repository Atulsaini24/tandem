import { JsonStreamParser, pathMatches } from "./json-stream.js";
import { streamChat, type ChatOptions } from "./ollama.js";
import { LIMITS, buildMessages, cleanColor, cleanSource, cleanText, schemaFor, type AiRequest, type ColorName } from "./plan.js";

/**
 * Board events, emitted while the model is still writing. Every event is already
 * validated: text cleaned and capped, colors from the palette, note references real and
 * unique, counts limited. Indexes are of ACCEPTED entries, so layout has no holes.
 */
export type AiEvent =
  | { readonly type: "title"; readonly title: string }
  | { readonly type: "column"; readonly column: number; readonly title: string; readonly color: ColorName }
  | {
      readonly type: "item";
      readonly column: number;
      readonly index: number;
      readonly text: string;
      /** Index of an existing note this item places (organize mode). */
      readonly source?: number;
      /** Rich plans: one-line detail, owner role, due date, priority. */
      readonly detail?: string;
      readonly owner?: string;
      readonly due?: string;
      readonly priority?: "high" | "medium" | "low";
    }
  | {
      readonly type: "done";
      readonly items: number;
      /** Things the model produced that validation threw away. */
      readonly rejected: number;
      /** Existing notes the model never placed (organize mode). */
      readonly unplaced: readonly number[];
      readonly tokens?: number;
      readonly tokensPerSecond?: number;
    };

export type AssistantOptions = Omit<ChatOptions, "messages" | "format">;

interface ColumnState {
  readonly index: number;
  title: string | undefined;
  color: ColorName | undefined;
  announced: boolean;
  items: number;
}

/**
 * Turns the model's streaming JSON into validated board events.
 * Generate mode reads columns[].items[] ({text}); organize mode reads columns[].notes[]
 * (note numbers), turning each into an item that places that existing note.
 */
export class BoardPlanReader {
  readonly #parser = new JsonStreamParser();
  readonly #notes: readonly string[];
  readonly #noteCount: number;
  readonly #columns = new Map<number, ColumnState>();
  readonly #usedSources = new Set<number>();
  #accepted = 0;
  #titleSent = false;
  items = 0;
  rejected = 0;

  /** `notes`: the existing notes (organize mode), or none (generate mode). */
  constructor(notes: readonly string[] = []) {
    this.#notes = notes.slice(0, LIMITS.notes);
    this.#noteCount = this.#notes.length;
  }

  push(chunk: string): AiEvent[] {
    const events: AiEvent[] = [];
    for (const { path, value } of this.#parser.push(chunk)) {
      if (pathMatches(path, ["title"]) && !this.#titleSent) {
        const title = cleanText(value, LIMITS.titleChars);
        if (title) {
          this.#titleSent = true;
          events.push({ type: "title", title });
        }
      } else if (pathMatches(path, ["columns", "#", "title"])) {
        const column = this.#column(path[1]);
        if (column) column.title = cleanText(value, LIMITS.titleChars);
      } else if (pathMatches(path, ["columns", "#", "color"])) {
        const column = this.#column(path[1]);
        if (column) {
          column.color = cleanColor(value, column.index);
          this.#announce(column, events);
        }
      } else if (pathMatches(path, ["columns", "#", "items", "#"])) {
        if (this.#noteCount === 0) this.#item(path[1], value, events);
        else this.rejected += 1; // organize mode never invents cards
      } else if (pathMatches(path, ["columns", "#", "notes", "#"])) {
        this.#noteRef(path[1], value, events);
      } else if (pathMatches(path, ["columns", "#"])) {
        const column = this.#column(path[1]);
        if (column) this.#announce(column, events); // a column with no items still gets its header
      }
    }
    return events;
  }

  /** Existing notes that never got placed. */
  unplaced(): number[] {
    return Array.from({ length: this.#noteCount }, (_, i) => i).filter((i) => !this.#usedSources.has(i));
  }

  #column(raw: unknown): ColumnState | undefined {
    if (typeof raw !== "number") return undefined;
    let column = this.#columns.get(raw);
    if (!column) {
      if (this.#accepted >= LIMITS.columns) {
        this.rejected += 1;
        return undefined;
      }
      column = { index: this.#accepted++, title: undefined, color: undefined, announced: false, items: 0 };
      this.#columns.set(raw, column);
    }
    return column;
  }

  #announce(column: ColumnState, events: AiEvent[]): void {
    if (column.announced) return;
    column.announced = true;
    events.push({
      type: "column",
      column: column.index,
      title: column.title ?? `Column ${column.index + 1}`,
      color: column.color ?? cleanColor(undefined, column.index),
    });
  }

  /** Generate mode: a new card. */
  #item(rawColumn: unknown, value: unknown, events: AiEvent[]): void {
    const column = this.#column(rawColumn);
    const item = typeof value === "object" && value !== null ? (value as { text?: unknown; detail?: unknown; owner?: unknown; due?: unknown; priority?: unknown }) : {};
    const text = cleanText(item.text, LIMITS.itemChars);
    const detail = cleanText(item.detail, 140);
    const owner = cleanText(item.owner, 30);
    const due = cleanText(item.due, 24);
    const priority = item.priority === "high" || item.priority === "medium" || item.priority === "low" ? item.priority : undefined;
    if (!column || !text || column.items >= LIMITS.itemsPerColumn) {
      this.rejected += 1;
      return;
    }
    this.#announce(column, events);
    this.items += 1;
    events.push({
      type: "item",
      column: column.index,
      index: column.items++,
      text,
      ...(detail ? { detail } : {}),
      ...(owner ? { owner } : {}),
      ...(due ? { due } : {}),
      ...(priority ? { priority } : {}),
    });
  }

  /** Organize mode: place an existing note. Each note at most once; bogus numbers dropped. */
  #noteRef(rawColumn: unknown, value: unknown, events: AiEvent[]): void {
    const column = this.#column(rawColumn);
    const source = cleanSource(value, this.#noteCount);
    if (!column || source === undefined || this.#usedSources.has(source) || column.items >= LIMITS.itemsPerColumn) {
      this.rejected += 1;
      return;
    }
    this.#announce(column, events);
    this.#usedSources.add(source);
    this.items += 1;
    const text = cleanText(this.#notes[source], LIMITS.itemChars) ?? `Note ${source + 1}`;
    events.push({ type: "item", column: column.index, index: column.items++, text, source });
  }
}

/** Ask the local model for a board and stream validated events as it writes. */
export async function* runAssistant(request: AiRequest, options: AssistantOptions): AsyncGenerator<AiEvent> {
  const reader = new BoardPlanReader(request.mode === "organize" ? request.notes : []);
  let tokens: number | undefined;
  let seconds: number | undefined;
  for await (const chunk of streamChat({ ...options, messages: buildMessages(request), format: schemaFor(request) })) {
    yield* reader.push(chunk.content);
    if (chunk.done) {
      tokens = chunk.evalCount;
      seconds = chunk.evalSeconds;
    }
  }
  yield {
    type: "done",
    items: reader.items,
    rejected: reader.rejected,
    unplaced: reader.unplaced(),
    ...(tokens === undefined ? {} : { tokens }),
    ...(tokens !== undefined && seconds ? { tokensPerSecond: Math.round((tokens / seconds) * 10) / 10 } : {}),
  };
}
