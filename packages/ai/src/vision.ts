import type { AssistantOptions } from "./assistant.js";
import { runJson } from "./creative.js";
import { cleanText, type ChatMessage } from "./plan.js";

/**
 * Photo → board. A vision model looks at a photo of a whiteboard, sticky notes on a wall or
 * a hand-drawn diagram and lists what it sees: each note or shape with its text, colour and
 * where it sits (as percentages of the photo), plus the arrows between them. The app turns
 * that into real, editable shapes laid out like the photo.
 */
export const VISION_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          kind: { type: "string", enum: ["note", "box", "ellipse", "diamond", "text", "group"] },
          color: { type: "string", enum: ["yellow", "pink", "green", "blue", "purple", "orange", "white"] },
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number" },
          h: { type: "number" },
        },
        required: ["id", "text", "kind", "color", "x", "y", "w", "h"],
      },
    },
    links: {
      type: "array",
      items: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, label: { type: "string" } }, required: ["from", "to"] },
    },
  },
  required: ["title", "items", "links"],
} as const;

const VISION_SYSTEM = `You digitize photos of whiteboards, sticky notes and hand-drawn diagrams. Reply ONLY with JSON matching the schema.
List EVERY note, box, shape, heading and piece of handwriting you can read, in reading order.
For each item:
- "id": short unique id like "n1", "n2".
- "text": the exact words written on it (fix obvious spelling, keep the meaning). Never invent text you can't see.
- "kind": "note" (sticky note), "box" (rectangle), "ellipse" (circle/oval, start/end), "diamond" (decision), "text" (loose handwriting or a heading), "group" (a big area or column that contains other items).
- "color": the closest of yellow, pink, green, blue, purple, orange, white.
- "x","y": the top-left corner, "w","h": the size, all as PERCENT of the photo (0 to 100).
"links": every arrow or line connecting two items, from the item it starts at to the item it points to, with its "label" if any.
"title": a short title for what the board is about.`;

export function buildVisionMessages(imageBase64: string, hint = ""): ChatMessage[] {
  const extra = cleanText(hint, 300);
  return [
    { role: "system", content: VISION_SYSTEM },
    { role: "user", content: `Digitize this photo into notes, shapes and arrows.${extra ? ` Context: ${extra}` : ""}`, images: [imageBase64] },
  ];
}

export interface VisionItem {
  readonly id: string;
  readonly text: string;
  readonly kind: "note" | "box" | "ellipse" | "diamond" | "text" | "group";
  readonly color: "yellow" | "pink" | "green" | "blue" | "purple" | "orange" | "white";
  /** Percent of the photo, 0..100. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface VisionResult {
  readonly title: string;
  readonly items: readonly VisionItem[];
  readonly links: ReadonlyArray<{ readonly from: string; readonly to: string; readonly label: string }>;
}

const KINDS = ["note", "box", "ellipse", "diamond", "text", "group"] as const;
const COLORS = ["yellow", "pink", "green", "blue", "purple", "orange", "white"] as const;
const pct = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, v <= 1 && v > 0 ? v * 100 : v)) : d);

/** Validate what the model said (untrusted): clamp numbers, drop empties, keep links that resolve. */
export function cleanVision(raw: unknown): VisionResult {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const seen = new Set<string>();
  const items = (Array.isArray(r.items) ? r.items : []).slice(0, 120).flatMap((x, i): VisionItem[] => {
    if (typeof x !== "object" || x === null) return [];
    const o = x as Record<string, unknown>;
    const text = cleanText(o.text, 300) ?? "";
    const kind = KINDS.includes(o.kind as (typeof KINDS)[number]) ? (o.kind as VisionItem["kind"]) : "note";
    if (!text && kind !== "group") return [];
    let id = cleanText(o.id, 20) ?? `n${i + 1}`;
    if (seen.has(id)) id = `${id}-${i}`;
    seen.add(id);
    return [
      {
        id,
        text,
        kind,
        color: COLORS.includes(o.color as (typeof COLORS)[number]) ? (o.color as VisionItem["color"]) : "yellow",
        x: pct(o.x, (i % 5) * 20),
        y: pct(o.y, Math.floor(i / 5) * 20),
        w: Math.max(4, pct(o.w, 16)),
        h: Math.max(3, pct(o.h, 12)),
      },
    ];
  });
  const ids = new Set(items.map((i) => i.id));
  const links = (Array.isArray(r.links) ? r.links : []).slice(0, 200).flatMap((x) => {
    if (typeof x !== "object" || x === null) return [];
    const o = x as Record<string, unknown>;
    const from = cleanText(o.from, 20) ?? "";
    const to = cleanText(o.to, 20) ?? "";
    return ids.has(from) && ids.has(to) && from !== to ? [{ from, to, label: cleanText(o.label, 40) ?? "" }] : [];
  });
  return { title: cleanText(r.title, 80) ?? "From a photo", items, links };
}

export async function runVision(imageBase64: string, hint: string, options: AssistantOptions): Promise<VisionResult & { tokensPerSecond?: number }> {
  const { value, tokensPerSecond } = await runJson(buildVisionMessages(imageBase64, hint), VISION_SCHEMA, options);
  return { ...cleanVision(value), ...(tokensPerSecond === undefined ? {} : { tokensPerSecond }) };
}

/** Models that can see images (by family name). */
export const isVisionModel = (name: string): boolean => /^(gemma3|llava|bakllava|llama3\.2-vision|qwen2\.5vl|qwen2\.5-vl|minicpm-v|moondream|granite3\.2-vision|mistral-small3\.1)/i.test(name);
