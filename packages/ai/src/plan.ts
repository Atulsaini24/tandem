/**
 * What the model is asked for: a BOARD PLAN (title, columns, items), never coordinates.
 * Small local models are good at content and bad at geometry, so layout is done by
 * deterministic code (layout.ts). Everything the model returns is untrusted text: it is
 * validated and capped here before it can become a canvas edit.
 */

export const COLORS = {
  blue: 0x2f63ff,
  orange: 0xef6b3a,
  green: 0x1e8f5a,
  purple: 0x7b55e7,
  pink: 0xdd4f78,
  teal: 0x137d77,
  red: 0xc6513c,
  yellow: 0xf2c94c,
  gray: 0x8a8f98,
} as const;
export type ColorName = keyof typeof COLORS;
const COLOR_NAMES = Object.keys(COLORS) as ColorName[];

export const LIMITS = {
  columns: 6,
  itemsPerColumn: 10,
  titleChars: 60,
  itemChars: 90,
  promptChars: 2_000,
  notes: 60,
} as const;

/**
 * JSON schema for Ollama's structured output: decoding is constrained to it, so the
 * reply is syntactically valid and in this property order. `title`/`color` come
 * before `items`, so a column's header can be placed before its cards stream in.
 */
export const BOARD_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    columns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          color: { type: "string", enum: COLOR_NAMES },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: { type: "string" },
                detail: { type: "string" },
                owner: { type: "string" },
                due: { type: "string" },
                priority: { type: "string", enum: ["high", "medium", "low"] },
                source: { type: "integer" },
              },
              required: ["text"],
            },
          },
        },
        required: ["title", "color", "items"],
      },
    },
  },
  required: ["title", "columns"],
} as const;

/**
 * Organize mode: columns hold NOTE NUMBERS only. The first version let the model write
 * items as {text, source}; the real-model eval showed gemma3:4b copying the notes' text
 * and never setting `source` (0 of 8 notes placed, 8 duplicates). Constrained decoding
 * against this schema makes that impossible: the model can only point at notes.
 */
export const ORGANIZE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    columns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          color: { type: "string", enum: COLOR_NAMES },
          notes: { type: "array", items: { type: "integer" } },
        },
        required: ["title", "color", "notes"],
      },
    },
  },
  required: ["title", "columns"],
} as const;

export type AiRequest =
  | { readonly mode: "generate"; readonly prompt: string }
  /** Sort existing notes into columns; the model refers to them by index. */
  | { readonly mode: "organize"; readonly prompt: string; readonly notes: readonly string[] };

export interface ChatMessage {
  readonly role: "system" | "user";
  readonly content: string;
  /** Base64 images (no data: prefix), for vision models. */
  readonly images?: readonly string[];
}

/** Trim, collapse whitespace, strip control characters, cap length (by code point). */
export function cleanText(raw: unknown, maxChars: number): string | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length === 0) return undefined;
  const chars = Array.from(text);
  return chars.length <= maxChars ? text : `${chars.slice(0, maxChars - 1).join("")}…`;
}

export function cleanColor(raw: unknown, fallbackIndex: number): ColorName {
  return typeof raw === "string" && raw in COLORS ? (raw as ColorName) : (COLOR_NAMES[fallbackIndex % COLOR_NAMES.length] ?? "blue");
}

/** An existing-note reference is only valid if it's an integer naming a real note. */
export function cleanSource(raw: unknown, noteCount: number): number | undefined {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw < noteCount ? raw : undefined;
}

const SYSTEM = `You are an expert planner building a detailed whiteboard plan.
Reply ONLY with JSON matching the schema:
- "title": a specific board title.
- "columns": 3 to ${LIMITS.columns} columns (phases, workstreams or themes), each with a short "title", a "color", and 3 to 6 "items".
- Each item: "text" = a concrete task or idea (under 60 characters, no numbering);
  "detail" = one sentence on how or why (under 110 characters);
  "owner" = a role (e.g. "Design lead", "CTO", "Marketing");
  "due" = when (e.g. "Week 2", "Day 30", "Before launch");
  "priority" = "high", "medium" or "low".
Be specific to the request: real tasks, real numbers where useful. No markdown.`;

const ORGANIZE_SYSTEM = `You are a whiteboard assistant. You sort existing numbered sticky notes into columns.
Reply ONLY with JSON matching the schema:
- "title": a short board title.
- "columns": 2 to ${LIMITS.columns} columns, each with a short "title", a "color", and "notes":
  the NUMBERS of the notes that belong in that column.
Put EVERY note number in exactly one column. Do not invent notes.`;

export function buildMessages(request: AiRequest): ChatMessage[] {
  const prompt = cleanText(request.prompt, LIMITS.promptChars) ?? "";
  if (request.mode === "generate") {
    return [
      { role: "system", content: SYSTEM },
      { role: "user", content: prompt || "Brainstorm a useful board." },
    ];
  }
  const notes = request.notes
    .slice(0, LIMITS.notes)
    .map((note, i) => `${i}: ${cleanText(note, LIMITS.itemChars) ?? "(empty)"}`)
    .join("\n");
  return [
    { role: "system", content: ORGANIZE_SYSTEM },
    { role: "user", content: `${prompt || "Organize these notes into a clear roadmap."}\n\nNotes:\n${notes}` },
  ];
}

export function schemaFor(request: AiRequest): object {
  return request.mode === "organize" ? ORGANIZE_SCHEMA : BOARD_SCHEMA;
}
