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
    type: { type: "string", enum: ["bar", "hbar", "stacked", "line", "area", "pie", "donut", "funnel", "radar"] },
    unit: { type: "string" },
    note: { type: "string" },
    kpis: {
      type: "array",
      items: { type: "object", properties: { label: { type: "string" }, value: { type: "string" }, delta: { type: "string" } }, required: ["label", "value", "delta"] },
    },
    labels: { type: "array", items: { type: "string" } },
    series: {
      type: "array",
      items: { type: "object", properties: { name: { type: "string" }, values: { type: "array", items: { type: "number" } } }, required: ["name", "values"] },
    },
    insight: { type: "string" },
  },
  required: ["title", "type", "unit", "note", "kpis", "labels", "series", "insight"],
} as const;

export const SCENE_MODELS = ["planet", "tree", "pine", "building", "house", "rocket", "cloud", "mountain", "car", "person", "server", "crystal"] as const;

export const SCENE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    backdrop: { type: "string", enum: ["space", "studio", "sky", "sunset", "night"] },
    objects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          shape: { type: "string", enum: ["box", "sphere", "cylinder", "cone", "torus", "plane", "ring", ...SCENE_MODELS] },
          label: { type: "string" },
          color: { type: "string" },
          position: { type: "array", items: { type: "number" } },
          size: { type: "array", items: { type: "number" } },
          material: { type: "string", enum: ["matte", "plastic", "metal", "glass"] },
          motion: { type: "string", enum: ["none", "spin", "orbit", "bob", "pulse", "float"] },
          orbitRadius: { type: "number" },
          speed: { type: "number" },
          glow: { type: "boolean" },
          rings: { type: "boolean" },
        },
        required: ["shape", "label", "color", "position", "size", "motion"],
      },
    },
  },
  required: ["title", "backdrop", "objects"],
} as const;

const ITEM = { type: "object", properties: { icon: { type: "string" }, title: { type: "string" }, text: { type: "string" } }, required: ["icon", "title", "text"] } as const;

export const DECK_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    theme: { type: "string", enum: ["midnight", "aurora", "sunset", "paper", "ocean", "noir"] },
    slides: {
      type: "array",
      items: {
        type: "object",
        properties: {
          layout: { type: "string", enum: ["title", "agenda", "cards", "stats", "chart", "quote", "timeline", "compare", "closing"] },
          kicker: { type: "string" },
          title: { type: "string" },
          subtitle: { type: "string" },
          items: { type: "array", items: ITEM },
          stats: { type: "array", items: { type: "object", properties: { value: { type: "string" }, label: { type: "string" }, delta: { type: "string" } }, required: ["value", "label"] } },
          chart: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["bar", "line", "area", "pie", "donut", "hbar"] },
              labels: { type: "array", items: { type: "string" } },
              series: { type: "array", items: { type: "object", properties: { name: { type: "string" }, values: { type: "array", items: { type: "number" } } } } },
              unit: { type: "string" },
            },
          },
          quote: { type: "object", properties: { text: { type: "string" }, author: { type: "string" } } },
          columns: { type: "array", items: { type: "object", properties: { title: { type: "string" }, items: { type: "array", items: { type: "string" } } } } },
        },
        required: ["layout", "kicker", "title"],
      },
    },
  },
  required: ["title", "theme", "slides"],
} as const;

const CHART_SYSTEM = `You are a senior data analyst making one presentation-quality chart for a whiteboard. Reply ONLY with JSON matching the schema.
Choose the best "type":
- "line" or "area": change over time (months, quarters, years). Use 2 series to compare (e.g. revenue vs costs, 2024 vs 2025).
- "bar": compare a few categories. "stacked": parts of each category (2-3 series). "hbar": a ranking of 5-10 items with long names.
- "pie"/"donut": parts of a whole, 3-7 slices that sum to a sensible total. "funnel": stages that shrink. "radar": scores of 1-3 options across 5-8 criteria.
Rules:
- "labels": 5 to 12 short labels (e.g. "Jan", "Q3 '25", "Samsung"). Every series has exactly one number per label.
- Numbers must be realistic, specific (not round like 100, 200, 300), internally consistent, and tell a story (growth, a dip, a leader).
- "unit": short: "$", "₹", "%", "k", "M", "users", "ms" or "".
- "kpis": exactly 3 headline numbers computed from the data, e.g. {"label":"Total revenue","value":"$4.2M","delta":"+38% YoY"} or {"label":"Best month","value":"Dec","delta":"$612k"}.
- "note": the source or assumption in a few words, e.g. "Illustrative estimates, FY2025".
- "insight": 1-2 sentences with the sharpest takeaway, citing numbers.`;

const SCENE_SYSTEM = `You are a 3D artist building a rich, beautiful scene for a whiteboard. Reply ONLY with JSON matching the schema.
Coordinates: y is up, units are meters, keep everything within -10..10. "position" is the center [x,y,z]; "size" is [width,height,depth].
Prefer ready-made models: "planet" (textured sphere; "rings": true for Saturn-like), "tree", "pine", "building", "house", "rocket", "cloud", "mountain", "car", "person", "server", "crystal". Primitives ("box","sphere","cylinder","cone","torus","plane","ring") fill in the rest.
Compose 10 to 30 objects that clearly tell the scene: a ground "plane" (size like [24,0.1,24]) for scenes on land, varied sizes and positions, nothing floating by accident, nothing overlapping.
"motion": "orbit" circles the center at "orbitRadius" (planets, satellites, cars on a ring road), "spin", "bob", "float" (gentle hover), "pulse" or "none". "speed" 0.2 to 2.
"material": "metal" for machines, "glass" for windows and crystals, "plastic" for toys, "matte" otherwise. "glow": true for suns, lamps, screens, energy.
"backdrop": "space", "sky" (day), "sunset", "night" (city lights) or "studio" (product shots). Give every object a short "label" ("" for small details). Use hex colors like "#3d7bff".`;

const DECK_SYSTEM = `You are a world-class presentation designer and strategist. Write a complete, specific, persuasive deck. Reply ONLY with JSON matching the schema.
Write 8 to 10 slides. Every slide has a short "kicker" (section name, 1-2 words, e.g. "Problem", "Market", "Roadmap") and a sharp "title" that states the point (a full idea, not a label).
Layouts and what to fill:
- "title": the FIRST slide only: "title" = the product or company name plus a bold promise (e.g. "Kirana AI: inventory that runs itself"), "kicker" = the occasion (e.g. "Seed round 2026"), "subtitle" = one compelling sentence.
- "agenda": "items" = 4-5 sections, each with "title" and a short "text".
- "cards": "items" = 3 or 4 points, each with an emoji "icon", a bold "title" (3-5 words) and "text" (one or two concrete sentences with specifics).
- "stats": "stats" = 3 big numbers, each {"value":"$4.2B","label":"what it measures","delta":"+18% YoY"}; "subtitle" = the takeaway.
- "chart": "chart" with "type", 5-8 "labels", "series" (1-2, one realistic number per label) and "unit"; "subtitle" = the takeaway; "items" = 2 short findings.
- "timeline": "items" = 4-5 phases in order, each with "title" (e.g. "Q1 · Beta") and "text" (what happens).
- "compare": "columns" = exactly 2: first = the old way or competitors (4 pain points), second = our way (4 advantages).
- "quote": "quote" = {"text": a memorable line, "author": who said it}.
- "closing": last slide: the ask or call to action as "title", a "subtitle", and "items" = 2-3 next steps (icon + title).
Use concrete names, numbers, dates and examples from the topic. Use at least 6 different layouts. No markdown, no placeholders like "Lorem" or "X%".
Pick a "theme": midnight (tech, bold), aurora (AI, climate), sunset (consumer, warm), paper (business, clean), ocean (health, finance), noir (luxury, premium).`;

const today = (): string => new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

export function buildChartMessages(prompt: string): ChatMessage[] {
  return [
    { role: "system", content: `${CHART_SYSTEM}
Today is ${today()}.` },
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
    { role: "system", content: `${DECK_SYSTEM}
Today is ${today()}: timelines start from now.` },
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
  readonly layout: string;
  readonly title: string;
  /** The slide as the model wrote it; the app validates it again before drawing. */
  readonly raw: Readonly<Record<string, unknown>>;
}

export type DeckEvent =
  | { readonly type: "title"; readonly title: string; readonly theme: string }
  | { readonly type: "slide"; readonly slide: DeckSlide }
  | { readonly type: "done"; readonly slides: number; readonly tokensPerSecond?: number };

/** Minimal check of one slide as it completes in the stream (needs a title). */
export function cleanSlide(raw: unknown, index: number): DeckSlide | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const title = cleanText(r.title, 120);
  if (!title) return undefined;
  return { index, layout: typeof r.layout === "string" ? r.layout : "cards", title, raw: r };
}

/** Stream a deck: each slide is placed the moment it's complete. */
export async function* runDeck(prompt: string, boardText: readonly string[], options: AssistantOptions): AsyncGenerator<DeckEvent> {
  const parser = new JsonStreamParser();
  let count = 0;
  let titleSent = false;
  let deckTitle = "";
  let theme = "";
  let tps: number | undefined;
  for await (const chunk of streamChat({ ...options, messages: buildDeckMessages(prompt, boardText), format: DECK_SCHEMA, temperature: 0.7 })) {
    for (const { path, value } of parser.push(chunk.content)) {
      if (pathMatches(path, ["title"])) deckTitle = cleanText(value, 90) ?? "";
      else if (pathMatches(path, ["theme"])) theme = typeof value === "string" ? value : "";
      if (pathMatches(path, ["slides", "#"]) && !titleSent) {
        // Title and theme come first in the schema, so they're known by the first slide.
        titleSent = true;
        yield { type: "title", title: deckTitle, theme };
      }
      if (pathMatches(path, ["slides", "#"]) && count < 12) {
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
