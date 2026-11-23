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

const ITEM = {
  type: "object",
  properties: { icon: { type: "string" }, title: { type: "string" }, value: { type: "string" }, text: { type: "string" } },
  required: ["icon", "title", "text"],
} as const;

export const SLIDE_LAYOUTS_AI = ["title", "agenda", "cards", "stats", "chart", "quote", "timeline", "compare", "closing", "statement", "team", "pricing", "process", "matrix"] as const;
export const SLIDE_THEMES_AI = ["midnight", "aurora", "sunset", "paper", "ocean", "noir", "neon", "forest", "royal", "mono"] as const;

/** One slide, as the model writes it (the app validates it again). */
export const SLIDE_SCHEMA = {
  type: "object",
  properties: {
    layout: { type: "string", enum: SLIDE_LAYOUTS_AI },
    kicker: { type: "string" },
    title: { type: "string" },
    subtitle: { type: "string" },
    items: { type: "array", items: ITEM },
    stats: { type: "array", items: { type: "object", properties: { value: { type: "string" }, label: { type: "string" }, delta: { type: "string" } }, required: ["value", "label"] } },
    chart: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["bar", "line", "area", "pie", "donut", "hbar", "stacked"] },
        labels: { type: "array", items: { type: "string" } },
        series: { type: "array", items: { type: "object", properties: { name: { type: "string" }, values: { type: "array", items: { type: "number" } } } } },
        unit: { type: "string" },
      },
    },
    quote: { type: "object", properties: { text: { type: "string" }, author: { type: "string" } } },
    columns: { type: "array", items: { type: "object", properties: { title: { type: "string" }, items: { type: "array", items: { type: "string" } } } } },
    axes: { type: "array", items: { type: "string" } },
  },
  required: ["layout", "kicker", "title"],
} as const;

export const DECK_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    theme: { type: "string", enum: SLIDE_THEMES_AI },
    slides: { type: "array", items: SLIDE_SCHEMA },
  },
  required: ["title", "theme", "slides"],
} as const;

/** Step 1 of a fast deck: the storyline only (short, so it comes back in seconds). */
export const OUTLINE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    theme: { type: "string", enum: SLIDE_THEMES_AI },
    slides: {
      type: "array",
      items: {
        type: "object",
        properties: { layout: { type: "string", enum: SLIDE_LAYOUTS_AI }, kicker: { type: "string" }, title: { type: "string" }, brief: { type: "string" } },
        required: ["layout", "kicker", "title", "brief"],
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

const LAYOUT_GUIDE = `Layouts and what to fill:
- "title": the FIRST slide only: "title" = the product or company name plus a bold promise (e.g. "Kirana AI: inventory that runs itself"), "kicker" = the occasion (e.g. "Seed round 2026"), "subtitle" = one compelling sentence.
- "agenda": "items" = 4-5 sections, each with "title" and a short "text".
- "cards": "items" = 3 or 4 points, each with an emoji "icon", a bold "title" (3-5 words) and "text" (one or two concrete sentences with specifics).
- "stats": "stats" = 3 big numbers, each {"value":"$4.2B","label":"what it measures","delta":"+18% YoY"} (or 1 for a single hero number); "subtitle" = the takeaway.
- "chart": "chart" with "type", 5-8 "labels", "series" (1-2, one realistic number per label) and "unit"; "subtitle" = the takeaway; "items" = 2 short findings.
- "timeline": "items" = 4-5 phases in order, each with "title" (e.g. "Q1 · Beta") and "text" (what happens).
- "process": "items" = 3-5 steps, each with "title", "value" (e.g. "Week 1") and "text".
- "compare": "columns" = exactly 2: first = the old way or competitors (4 pain points), second = our way (4 advantages).
- "matrix": "axes" = [x axis, y axis] (e.g. ["Effort", "Impact"]); "items" = 4 quadrants, the FIRST is the best one, each with "title" and "text".
- "team": "items" = 3-6 people, "title" = full name, "value" = role, "text" = one line of experience.
- "pricing": "items" = 3 plans, "title" = plan name, "value" = price (e.g. "₹299/mo"), "text" = 4 features separated by ";".
- "statement": one bold sentence as "title" with the key words wrapped in *asterisks*; optional "subtitle".
- "quote": "quote" = {"text": a memorable line, "author": who said it}.
- "closing": last slide: the ask or call to action as "title", a "subtitle", and "items" = 2-3 next steps (icon + title).
Use concrete names, numbers, dates and examples from the topic. No markdown, no placeholders like "Lorem" or "X%".`;

const THEME_GUIDE = `Pick a "theme": midnight (tech, bold), aurora (AI, climate), sunset (consumer, warm), paper (business, clean), ocean (health, finance), noir (luxury, premium), neon (gaming, events, youth), forest (sustainability, food), royal (education, culture), mono (minimal, design).`;

const DECK_SYSTEM = `You are a world-class presentation designer and strategist. Write a complete, specific, persuasive deck. Reply ONLY with JSON matching the schema.
Write 8 to 10 slides. Every slide has a short "kicker" (section name, 1-2 words, e.g. "Problem", "Market", "Roadmap") and a sharp "title" that states the point (a full idea, not a label). Use at least 6 different layouts.
${LAYOUT_GUIDE}
${THEME_GUIDE}`;

const OUTLINE_SYSTEM = `You are a world-class presentation strategist. Plan the storyline of a persuasive deck. Reply ONLY with JSON matching the schema.
Plan exactly 8 slides (9 at most). The first is "title", the last is "closing". Use at least 7 different layouts from: title, agenda, cards, stats, chart, timeline, process, compare, matrix, team, pricing, statement, quote, closing.
For each slide: "layout", a 1-2 word "kicker", a sharp "title" that states the point, and a "brief" of at most 15 words saying what the slide must show (name the facts or numbers to use).
${THEME_GUIDE}`;

const SLIDE_SYSTEM = `You are a world-class presentation designer. Write ONE slide of a deck, rich and specific. Reply ONLY with JSON matching the schema.
${LAYOUT_GUIDE}`;

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

export interface OutlineSlide {
  readonly index: number;
  readonly layout: string;
  readonly kicker: string;
  readonly title: string;
  readonly brief: string;
}

export type FastDeckEvent =
  | { readonly type: "plan"; readonly title: string; readonly theme: string }
  | { readonly type: "placeholder"; readonly slide: OutlineSlide }
  | { readonly type: "planned"; readonly total: number }
  | { readonly type: "slide"; readonly slide: DeckSlide }
  | { readonly type: "failed"; readonly index: number }
  | { readonly type: "done"; readonly slides: number; readonly tokensPerSecond?: number };

export function buildOutlineMessages(prompt: string, boardText: readonly string[] = []): ChatMessage[] {
  const about = cleanText(prompt, LIMITS.promptChars) ?? "Our product";
  const context = boardText.length > 0 ? `\n\nUse these notes from the board as material:\n${boardText.slice(0, 60).map((t) => `- ${cleanText(t, 160) ?? ""}`).join("\n")}` : "";
  return [
    { role: "system", content: `${OUTLINE_SYSTEM}\nToday is ${today()}: timelines start from now.` },
    { role: "user", content: `${about}${context}` },
  ];
}

export function buildSlideMessages(topic: string, deckTitle: string, outline: readonly OutlineSlide[], slide: OutlineSlide): ChatMessage[] {
  const story = outline.map((s) => `${s.index + 1}. [${s.layout}] ${s.title}`).join("\n");
  return [
    { role: "system", content: `${SLIDE_SYSTEM}\nToday is ${today()}.` },
    {
      role: "user",
      content: `Deck: "${deckTitle}" — ${cleanText(topic, LIMITS.promptChars) ?? ""}\nStoryline:\n${story}\n\nWrite slide ${slide.index + 1}. Layout: "${slide.layout}". Kicker: "${slide.kicker}". Title: "${slide.title}".\nIt must show: ${slide.brief}`,
    },
  ];
}

/** Rewrite one slide following an instruction ("punchier", "add numbers", "make it a timeline"). */
export function buildSlideRewriteMessages(slide: Readonly<Record<string, unknown>>, instruction: string, deckTitle: string): ChatMessage[] {
  return [
    { role: "system", content: `${SLIDE_SYSTEM}\nToday is ${today()}. You are editing an existing slide: keep what works, apply the instruction fully, and keep the same layout unless the instruction asks for another.` },
    { role: "user", content: `Deck: "${deckTitle}"\nCurrent slide JSON:\n${JSON.stringify(slide).slice(0, 3000)}\n\nInstruction: ${cleanText(instruction, 300) ?? "Make it more specific and persuasive."}` },
  ];
}

function cleanOutlineSlide(raw: unknown, index: number): OutlineSlide | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  const title = cleanText(o.title, 120);
  if (!title) return undefined;
  return { index, layout: typeof o.layout === "string" ? o.layout : "cards", kicker: cleanText(o.kicker, 40) ?? "", title, brief: cleanText(o.brief, 240) ?? "" };
}

const MAX_SLIDES = 10;

/**
 * A deck that shows up fast. The outline streams: each slide appears as a placeholder the
 * moment its line is planned. Once the outline is complete, each slide is written in its
 * own request (`parallel` at a time; Ollama runs them together when
 * OLLAMA_NUM_PARALLEL allows) and lands the moment it's done. A slide that fails keeps
 * its outline version.
 */
export async function* runDeckFast(prompt: string, boardText: readonly string[], options: AssistantOptions, parallel = 2): AsyncGenerator<FastDeckEvent> {
  const outline: OutlineSlide[] = [];
  const queue: OutlineSlide[] = [];
  const events: FastDeckEvent[] = [];
  let title = "";
  let theme = "";
  let planned = false;
  let outlineDone = false;
  let failure: unknown;
  let running = 0;
  let made = 0;
  const rates: number[] = [];
  // One "something happened" signal for both the workers and the consumer.
  let waiters: Array<() => void> = [];
  const notify = (): void => {
    const w = waiters;
    waiters = [];
    for (const fn of w) fn();
  };
  const waitFor = (ready: () => boolean): Promise<void> =>
    new Promise<void>((resolve) => {
      if (ready()) resolve();
      else waiters.push(resolve);
    });
  const push = (e: FastDeckEvent): void => {
    events.push(e);
    notify();
  };

  const planner = (async () => {
    const parser = new JsonStreamParser();
    for await (const chunk of streamChat({ ...options, messages: buildOutlineMessages(prompt, boardText), format: OUTLINE_SCHEMA, temperature: 0.6 })) {
      for (const { path, value } of parser.push(chunk.content)) {
        if (pathMatches(path, ["title"])) title = cleanText(value, 90) ?? "";
        else if (pathMatches(path, ["theme"])) theme = typeof value === "string" ? value : "";
        else if (pathMatches(path, ["slides", "#"]) && outline.length < MAX_SLIDES) {
          const s = cleanOutlineSlide(value, outline.length);
          if (!s) continue;
          if (!planned) {
            planned = true;
            push({ type: "plan", title, theme });
          }
          outline.push(s);
          queue.push(s);
          push({ type: "placeholder", slide: s });
        }
      }
    }
  })()
    .catch((e: unknown) => {
      failure = e;
    })
    .finally(() => {
      outlineDone = true;
      if (outline.length === 0 && !failure) failure = new Error("The model didn't return a storyline. Try rephrasing.");
      push({ type: "planned", total: outline.length });
    });

  const work = async (): Promise<void> => {
    for (;;) {
      // Writing starts once the storyline is complete: sharing the model with the outline
      // slows the outline down, and every slide gets the whole storyline as context.
      await waitFor(() => outlineDone || options.signal?.aborted === true);
      const s = queue.shift();
      if (!s) {
        if (outlineDone || options.signal?.aborted) return;
        continue;
      }
      if (options.signal?.aborted) return;
      try {
        const { value: v, tokensPerSecond } = await runJson(buildSlideMessages(prompt, title, outline, s), SLIDE_SCHEMA, options);
        if (tokensPerSecond) rates.push(tokensPerSecond);
        const raw = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
        const slide = cleanSlide({ ...raw, layout: raw.layout ?? s.layout, title: raw.title || s.title, kicker: raw.kicker || s.kicker }, s.index);
        if (slide) {
          made += 1;
          push({ type: "slide", slide });
        } else push({ type: "failed", index: s.index });
      } catch {
        if (options.signal?.aborted) return;
        push({ type: "failed", index: s.index });
      }
    }
  };
  const workers = Array.from({ length: Math.max(1, parallel) }, () => {
    running += 1;
    return work().finally(() => {
      running -= 1;
      notify();
    });
  });

  for (;;) {
    const next = events.shift();
    if (next) {
      yield next;
      continue;
    }
    if (failure) throw failure;
    if (outlineDone && running === 0) break;
    await waitFor(() => events.length > 0 || (outlineDone && running === 0) || failure !== undefined);
  }
  await planner;
  await Promise.all(workers);
  const tps = rates.length > 0 ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10 : undefined;
  yield { type: "done", slides: made, ...(tps === undefined ? {} : { tokensPerSecond: tps }) };
}

/** Change an existing chart following an instruction ("show it as a donut", "add 2024 for comparison"). */
export function buildChartRewriteMessages(chart: Readonly<Record<string, unknown>>, instruction: string): ChatMessage[] {
  return [
    { role: "system", content: `${CHART_SYSTEM}\nToday is ${today()}. You are editing an existing chart: keep its data unless the instruction changes it, and return the whole chart.` },
    { role: "user", content: `Current chart JSON:\n${JSON.stringify(chart).slice(0, 3000)}\n\nInstruction: ${cleanText(instruction, 300) ?? "Make it clearer."}` },
  ];
}
