import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  BoardPlanReader,
  LIMITS,
  OllamaError,
  buildMessages,
  headerRect,
  itemRect,
  runAssistant,
  titleRect,
  type AiEvent,
  type Rect,
} from "../src/index.js";

/** Feed a full reply to a reader in small chunks, like a streaming model would. */
function readAll(reply: string, notes: readonly string[] = [], chunkSize = 7): { events: AiEvent[]; reader: BoardPlanReader } {
  const reader = new BoardPlanReader(notes);
  const events: AiEvent[] = [];
  for (let i = 0; i < reply.length; i += chunkSize) events.push(...reader.push(reply.slice(i, i + chunkSize)));
  return { events, reader };
}

const board = (columns: unknown[], title: unknown = "Launch plan"): string => JSON.stringify({ title, columns });

describe("BoardPlanReader", () => {
  it("streams title, column headers and items in order, with dense indexes", () => {
    const { events } = readAll(
      board([
        { title: "Now", color: "red", items: [{ text: "Fix login" }, { text: "Ship beta" }] },
        { title: "Next", color: "blue", items: [{ text: "Billing" }] },
      ]),
    );
    expect(events).toEqual([
      { type: "title", title: "Launch plan" },
      { type: "column", column: 0, title: "Now", color: "red" },
      { type: "item", column: 0, index: 0, text: "Fix login" },
      { type: "item", column: 0, index: 1, text: "Ship beta" },
      { type: "column", column: 1, title: "Next", color: "blue" },
      { type: "item", column: 1, index: 0, text: "Billing" },
    ]);
  });

  it("cleans hostile or sloppy output instead of passing it through", () => {
    const { events, reader } = readAll(
      board([
        {
          title: "  Now\n\n\tplease  ",
          color: "chartreuse", // not in the palette
          items: [{ text: "x".repeat(500) }, { text: "" }, { text: 42 }, { nope: true }, "just a string", { text: "ok\u0000\u0007 item" }],
        },
      ], "T".repeat(300)),
    );
    const title = events.find((e) => e.type === "title");
    expect(title?.type === "title" && Array.from(title.title).length).toBe(LIMITS.titleChars);
    const column = events.find((e) => e.type === "column");
    expect(column).toMatchObject({ title: "Now please", color: "blue" }); // palette fallback
    const items = events.filter((e) => e.type === "item");
    expect(items).toHaveLength(2);
    expect(items[0]?.type === "item" && Array.from(items[0].text).length).toBe(LIMITS.itemChars);
    expect(items[1]).toMatchObject({ text: "ok item", index: 1 }); // control chars gone, index dense
    expect(reader.rejected).toBe(4);
  });

  it("caps columns and items per column", () => {
    const many = Array.from({ length: 10 }, (_, c) => ({
      title: `C${c}`,
      color: "green",
      items: Array.from({ length: 30 }, (_, i) => ({ text: `item ${i}` })),
    }));
    const { events } = readAll(board(many));
    expect(events.filter((e) => e.type === "column")).toHaveLength(LIMITS.columns);
    expect(events.filter((e) => e.type === "item")).toHaveLength(LIMITS.columns * LIMITS.itemsPerColumn);
  });

  it("organize mode: notes placed by NUMBER, once each; bogus numbers and invented cards dropped", () => {
    const notes = ["Fix login", "Billing", "Beta invites", "Pricing"];
    const { events, reader } = readAll(
      board([
        { title: "Now", color: "teal", notes: [0, 2, 0] }, // 0 twice
        { title: "Later", color: "pink", notes: [99, 1.5, -1], items: [{ text: "invented" }] },
      ]),
      notes,
    );
    const items = events.filter((e): e is Extract<AiEvent, { type: "item" }> => e.type === "item");
    // The card text comes from the user's note, never from the model.
    expect(items.map((i) => [i.text, i.source, i.column])).toEqual([
      ["Fix login", 0, 0],
      ["Beta invites", 2, 0],
    ]);
    expect(reader.unplaced()).toEqual([1, 3]);
    expect(reader.rejected).toBe(5);
  });

  it("the REGRESSION the real-model eval found: copying note text instead of numbers creates nothing", () => {
    const notes = ["Fix login", "Billing"];
    const { events } = readAll(board([{ title: "Now", color: "red", items: [{ text: "Fix login" }, { text: "Billing" }] }]), notes);
    expect(events.filter((e) => e.type === "item")).toEqual([]); // no duplicates of the user's notes
  });

  it("PROPERTY: whatever JSON the model produces, events are valid and layout never overlaps", () => {
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 5 }), fc.nat({ max: 8 }), (value, noteCount) => {
        const notes = Array.from({ length: noteCount }, (_, i) => `note ${i}`);
        const { events } = readAll(JSON.stringify({ title: "t", columns: value }), notes, 5);
        const rects: Rect[] = [titleRect({ x: 0, y: 0 })];
        const sources = new Set<number>();
        for (const e of events) {
          if (e.type === "column") {
            expect(e.column).toBeLessThan(LIMITS.columns);
            rects.push(headerRect({ x: 0, y: 0 }, e.column));
          }
          if (e.type === "item") {
            expect(e.index).toBeLessThan(LIMITS.itemsPerColumn);
            expect(e.text.length).toBeGreaterThan(0);
            if (e.source !== undefined) {
              expect(e.source).toBeLessThan(noteCount);
              expect(sources.has(e.source)).toBe(false);
              sources.add(e.source);
            }
            rects.push(itemRect({ x: 0, y: 0 }, e.column, e.index));
          }
        }
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i];
            const b = rects[j];
            if (!a || !b) continue;
            const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
            expect(overlap).toBe(false);
          }
        }
      }),
      { numRuns: 1_000 },
    );
  });
});

describe("prompts", () => {
  it("organize mode numbers the notes and states the placement rules", () => {
    const messages = buildMessages({ mode: "organize", prompt: "Make a roadmap", notes: ["Login", "Billing  \n page"] });
    const user = messages.find((m) => m.role === "user")?.content ?? "";
    expect(user).toContain("0: Login");
    expect(user).toContain("1: Billing page");
    expect(messages[0]?.content).toContain("EVERY note number");
  });
});

/** A fake Ollama: streams the reply as NDJSON lines, split at awkward byte boundaries. */
function fakeOllama(reply: string, status = 200): typeof fetch {
  return (async () => {
    if (status !== 200) return new Response(JSON.stringify({ error: "model 'nope' not found" }), { status });
    const lines = [...reply].map((ch) => JSON.stringify({ message: { content: ch }, done: false }));
    lines.push(JSON.stringify({ message: { content: "" }, done: true, eval_count: 120, eval_duration: 10e9 }));
    const ndjson = new TextEncoder().encode(`${lines.join("\n")}\n`);
    return new Response(
      new ReadableStream({
        start(controller) {
          for (let i = 0; i < ndjson.length; i += 13) controller.enqueue(ndjson.slice(i, i + 13));
          controller.close();
        },
      }),
    );
  }) as typeof fetch;
}

describe("runAssistant (fake Ollama)", () => {
  it("streams events end to end and reports speed", async () => {
    const reply = board([{ title: "Now", color: "red", items: [{ text: "A" }, { text: "B" }] }]);
    const events: AiEvent[] = [];
    for await (const e of runAssistant({ mode: "generate", prompt: "x" }, { url: "http://ollama", model: "m", fetch: fakeOllama(reply) })) {
      events.push(e);
    }
    expect(events.filter((e) => e.type === "item")).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: "done", items: 2, tokens: 120, tokensPerSecond: 12 });
  });

  it("explains a missing model and an unreachable server", async () => {
    const run = async (fetchImpl: typeof fetch): Promise<AiEvent[]> => {
      const events: AiEvent[] = [];
      for await (const event of runAssistant({ mode: "generate", prompt: "x" }, { url: "http://ollama", model: "nope", fetch: fetchImpl })) {
        events.push(event);
      }
      return events;
    };
    await expect(run(fakeOllama("", 404))).rejects.toThrow(/ollama pull nope/);
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(run(offline)).rejects.toThrow(OllamaError);
  });
});
