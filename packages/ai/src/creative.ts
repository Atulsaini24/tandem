import type { AssistantOptions } from "./assistant.js";
import { JsonStreamParser, pathMatches } from "./json-stream.js";
import { streamChat } from "./ollama.js";
import { LIMITS, cleanText, type ChatMessage } from "./plan.js";

/**
 * Charts, 3D scenes and slide decks. As everywhere else: the model fills a schema Ollama
 * enforces, the output is untrusted (the app validates and clamps it again before
 * drawing), and the model never chooses canvas coordinates.
 */

export const CHART_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    type: { type: "string", enum: ["bar", "line", "area", "pie", "donut", "funnel"] },
    unit: { type: "string" },
    note: { type: "string" },
    labels: { type: "array", items: { type: "string" } },
    series: {
      type: "array",
      items: { type: "object", properties: { name: { type: "string" }, values: { type: "array", items: { type: "number" } } }, required: ["name", "values"] },
    },
    insight: { type: "string" },
  },
  required: ["title", "type", "labels", "series", "insight"],
} as const;

export const SCENE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    backdrop: { type: "string", enum: ["space", "studio", "sky"] },
    objects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          shape: { type: "string", enum: ["box", "sphere", "cylinder", "cone", "torus", "plane", "ring"] },
          label: { type: "string" },
          color: { type: "string" },
          position: { type: "array", items: { type: "number" } },
          size: { type: "array", items: { type: "number" } },
          motion: { type: "string", enum: ["none", "spin", "orbit", "bob", "pulse"] },
          orbitRadius: { type: "number" },
          speed: { type: "number" },
          glow: { type: "boolean" },
        },
        required: ["shape", "color", "position", "size", "motion"],
      },
    },
  },
  required: ["title", "backdrop", "objects"],
} as const;

export const DECK_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    slides: {
      type: "array",
      items: {
        type: "object",
        properties: {
          layout: { type: "string", enum: ["title", "bullets", "stats", "quote", "chart"] },
          title: { type: "string" },
          subtitle: { type: "string" },
          bullets: { type: "array", items: { type: "string" } },
          stats: { type: "array", items: { type: "object", properties: { value: { type: "string" }, label: { type: "string" } }, required: ["value", "label"] } },
          chart: { type: "object", properties: { type: { type: "string", enum: ["bar", "line", "pie", "donut"] }, labels: { type: "array", items: { type: "string" } }, values: { type: "array", items: { type: "number" } }, unit: { type: "string" } } },
        },
        required: ["layout", "title"],
      },
    },
  },
  required: ["title", "slides"],
} as const;

const CHART_SYSTEM = `You are a data designer for a whiteboard. Reply ONLY with JSON matching the schema.
Pick the best chart "type" for the request: bar (compare categories), line/area (change over time), pie/donut (parts of a whole, max 7 slices), funnel (stages that shrink).
- "labels": 4 to 12 short category or time labels.
- "series": 1 to 3 series; each "values" has exactly one realistic number per label. Use plausible, internally consistent numbers.
- "unit": e.g. "$", "%", "users", "k", or "".
- "note": one short line saying where numbers come from, e.g. "Illustrative estimates".
- "insight": one sentence with the key takeaway from the data.`;

const SCENE_SYSTEM = `You build small 3D scenes for a whiteboard. Reply ONLY with JSON matching the schema.
Coordinates: y is up, units are meters, keep everything within -8..8. "position" is [x,y,z] of the object's center; "size" is [width,height,depth] (spheres use width as diameter; torus/ring use width as diameter).
Compose a clear, recognizable scene with 6 to 25 objects: use a ground "plane" for scenes on the ground, stack boxes for buildings/servers, cones+cylinders for trees, spheres for planets.
"motion": "orbit" (circles the center at "orbitRadius", great for planets/satellites), "spin", "bob", "pulse" or "none". "glow": true for suns, lights, highlights.
"backdrop": "space" for space scenes, "sky" for outdoor scenes, "studio" otherwise. Give important objects a short "label". Use hex colors like "#3d7bff".`;

const DECK_SYSTEM = `You write slide decks. Reply ONLY with JSON matching the schema.
Write 6 to 9 slides that tell a clear story. Mix layouts:
- "title": the first slide, with a strong "subtitle".
- "bullets": 3 to 5 crisp "bullets" (under 70 characters each, no numbering).
- "stats": 3 "stats", each a big "value" (like "3x", "$2.4M", "92%") and a short "label".
- "quote": a memorable one-line "subtitle".
- "chart": a "chart" with 4 to 8 "labels" and matching "values" (plausible numbers), plus a "subtitle" with the takeaway.
End with a call to action. No markdown.`;

export function buildChartMessages(prompt: string): ChatMessage[] {
  return [
    { role: "system", content: CHART_SYSTEM },
    { role: "user", content: cleanText(prompt, LIMITS.promptChars) ?? "Monthly revenue of a growing startup" },
  ];
}

export function buildSceneMessages(prompt: string): ChatMessage[] {
  return [
    { role: "system", content: SCENE_SYSTEM },
    { role: "user", content: cleanText(prompt, LIMITS.promptChars) ?? "The solar system" },
  ];
}

export function buildDeckMessages(prompt: string, boardText: readonly string[] = []): ChatMessage[] {
  const about = cleanText(prompt, LIMITS.promptChars) ?? "Our product";
  const context = boardText.length > 0 ? `\n\nUse these notes from the board as material:\n${boardText.slice(0, 60).map((t) => `- ${cleanText(t, 160) ?? ""}`).join("\n")}` : "";
  return [
    { role: "system", content: DECK_SYSTEM },
    { role: "user", content: `${about}${context}` },
  ];
}

export interface CreativeProgress {
  readonly tokens: number;
}

/** Run a schema-constrained request and return the parsed JSON (validated by the caller). */
export async function runJson(messages: readonly ChatMessage[], format: object, options: AssistantOptions, onProgress?: (p: CreativeProgress) => void): Promise<{ value: unknown; tokensPerSecond?: number }> {
  let text = "";
  let chunks = 0;
  let tps: number | undefined;
  for await (const chunk of streamChat({ ...options, messages, format, temperature: 0.5 })) {
    text += chunk.content;
    chunks += 1;
    if (chunks % 8 === 0) onProgress?.({ tokens: chunks });
    if (chunk.done && chunk.evalCount && chunk.evalSeconds) tps = Math.round((chunk.evalCount / chunk.evalSeconds) * 10) / 10;
  }
  try {
    return { value: JSON.parse(text), ...(tps === undefined ? {} : { tokensPerSecond: tps }) };
  } catch {
    throw new Error("The model's answer wasn't valid JSON. Try again or pick another model.");
  }
}

export interface DeckSlide {
  readonly index: number;
  readonly layout: "title" | "bullets" | "stats" | "quote" | "chart";
  readonly title: string;
  readonly subtitle: string;
  readonly bullets: readonly string[];
  readonly stats: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  readonly chart?: { readonly type: string; readonly labels: readonly string[]; readonly values: readonly number[]; readonly unit: string };
}

export type DeckEvent = { readonly type: "title"; readonly title: string } | { readonly type: "slide"; readonly slide: DeckSlide } | { readonly type: "done"; readonly slides: number; readonly tokensPerSecond?: number };

const LAYOUTS = ["title", "bullets", "stats", "quote", "chart"] as const;

/** Validate one slide as it completes in the stream. */
export function cleanSlide(raw: unknown, index: number): DeckSlide | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const title = cleanText(r.title, 90);
  if (!title) return undefined;
  const layout = LAYOUTS.includes(r.layout as (typeof LAYOUTS)[number]) ? (r.layout as DeckSlide["layout"]) : "bullets";
  const bullets = (Array.isArray(r.bullets) ? r.bullets : []).flatMap((b) => {
    const t = cleanText(b, 110);
    return t ? [t] : [];
  }).slice(0, 6);
  const stats = (Array.isArray(r.stats) ? r.stats : []).flatMap((s) => {
    if (typeof s !== "object" || s === null) return [];
    const o = s as Record<string, unknown>;
    const value = cleanText(o.value, 14);
    const label = cleanText(o.label, 40);
    return value && label ? [{ value, label }] : [];
  }).slice(0, 4);
  let chart: DeckSlide["chart"];
  if (typeof r.chart === "object" && r.chart !== null) {
    const c = r.chart as Record<string, unknown>;
    const labels = (Array.isArray(c.labels) ? c.labels : []).map((l) => cleanText(l, 24) ?? "").slice(0, 10);
    const values = (Array.isArray(c.values) ? c.values : []).map((v) => (typeof v === "number" && Number.isFinite(v) ? v : 0)).slice(0, labels.length);
    if (values.length >= 2) chart = { type: typeof c.type === "string" ? c.type : "bar", labels, values, unit: cleanText(c.unit, 8) ?? "" };
  }
  return { index, layout: layout === "chart" && !chart ? "bullets" : layout, title, subtitle: cleanText(r.subtitle, 160) ?? "", bullets, stats, ...(chart ? { chart } : {}) };
}

/** Stream a deck: each slide is placed the moment it's complete. */
export async function* runDeck(prompt: string, boardText: readonly string[], options: AssistantOptions): AsyncGenerator<DeckEvent> {
  const parser = new JsonStreamParser();
  let count = 0;
  let titleSent = false;
  let tps: number | undefined;
  for await (const chunk of streamChat({ ...options, messages: buildDeckMessages(prompt, boardText), format: DECK_SCHEMA, temperature: 0.6 })) {
    for (const { path, value } of parser.push(chunk.content)) {
      if (pathMatches(path, ["title"]) && !titleSent) {
        const title = cleanText(value, 90);
        if (title) {
          titleSent = true;
          yield { type: "title", title };
        }
      } else if (pathMatches(path, ["slides", "#"]) && count < 12) {
        const slide = cleanSlide(value, count);
        if (slide) {
          count += 1;
          yield { type: "slide", slide };
        }
      }
    }
    if (chunk.done && chunk.evalCount && chunk.evalSeconds) tps = Math.round((chunk.evalCount / chunk.evalSeconds) * 10) / 10;
  }
  yield { type: "done", slides: count, ...(tps === undefined ? {} : { tokensPerSecond: tps }) };
}
