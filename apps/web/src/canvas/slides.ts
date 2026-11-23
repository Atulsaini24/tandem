/**
 * Designed slides. A slide shape stores a JSON spec (layout + content + theme); this module
 * validates it (untrusted: from the AI or another user) and draws it as one SVG, like a
 * slide from a design tool: themed background, typography, cards, numbers, charts. The
 * same markup is rasterized on the canvas, exported, and animated live in Present mode.
 */
import { chartSvg, parseChart, type ChartSpec, type ChartTheme } from "./charts";
import { anim, deltaTone, fitSize, FONT, mix, n1, textLines, textWidth, wrapText } from "./svg-kit";

export type SlideLayout =
  | "title" | "agenda" | "cards" | "stats" | "chart" | "quote" | "timeline" | "compare" | "closing"
  | "statement" | "team" | "pricing" | "process" | "matrix";
export type SlideThemeName = "midnight" | "aurora" | "sunset" | "paper" | "ocean" | "noir" | "neon" | "forest" | "royal" | "mono";

export const SLIDE_LAYOUTS: readonly SlideLayout[] = ["title", "agenda", "cards", "stats", "chart", "quote", "timeline", "compare", "closing", "statement", "team", "pricing", "process", "matrix"];
export const SLIDE_THEMES: readonly SlideThemeName[] = ["midnight", "aurora", "sunset", "paper", "ocean", "noir", "neon", "forest", "royal", "mono"];

/** What each layout shows, for pickers. */
export const LAYOUT_INFO: Record<SlideLayout, { readonly name: string; readonly hint: string }> = {
  title: { name: "Title", hint: "Opening slide with art" },
  agenda: { name: "Agenda", hint: "Numbered sections" },
  cards: { name: "Cards", hint: "3–6 points with icons" },
  stats: { name: "Big numbers", hint: "1–4 headline stats" },
  chart: { name: "Chart", hint: "Chart plus findings" },
  quote: { name: "Quote", hint: "Testimonial" },
  timeline: { name: "Timeline", hint: "Phases in order" },
  compare: { name: "Compare", hint: "Old way vs new way" },
  closing: { name: "Closing", hint: "The ask + buttons" },
  statement: { name: "Statement", hint: "One bold idea, *highlighted*" },
  team: { name: "Team", hint: "People and roles" },
  pricing: { name: "Pricing", hint: "Plans with features" },
  process: { name: "Process", hint: "Steps as arrows" },
  matrix: { name: "2×2 matrix", hint: "Four quadrants" },
};

export interface SlideItem {
  readonly icon: string;
  readonly title: string;
  readonly text: string;
  /** A price, metric or date shown big (pricing, process). */
  readonly value: string;
}

export interface SlideStat {
  readonly value: string;
  readonly label: string;
  readonly delta: string;
}

export interface SlideSpec {
  readonly theme: SlideThemeName;
  readonly layout: SlideLayout;
  readonly kicker: string;
  readonly title: string;
  readonly subtitle: string;
  readonly items: readonly SlideItem[];
  readonly stats: readonly SlideStat[];
  readonly chart?: ChartSpec;
  readonly quote: { readonly text: string; readonly author: string };
  readonly columns: ReadonlyArray<{ readonly title: string; readonly items: readonly string[] }>;
  /** Matrix: the horizontal and vertical axis labels. */
  readonly axes: readonly [string, string];
  /** Still being written by the AI: drawn as a placeholder. */
  readonly pending: boolean;
  /** Footer: deck name and position. */
  readonly deck: string;
  readonly index: number;
  readonly total: number;
}

export interface SlideTheme {
  readonly bg1: string;
  readonly bg2: string;
  readonly ink: string;
  readonly muted: string;
  readonly accent: string;
  readonly accent2: string;
  readonly panel: string;
  readonly grid: string;
  readonly dark: boolean;
}

export const THEMES: Record<SlideThemeName, SlideTheme> = {
  midnight: { bg1: "#070b1f", bg2: "#141d4a", ink: "#f4f6ff", muted: "#a5aed0", accent: "#5b8cff", accent2: "#b36bff", panel: "#151d45", grid: "#2a3470", dark: true },
  aurora: { bg1: "#04131a", bg2: "#0c2f38", ink: "#ecfffa", muted: "#9cc7bf", accent: "#2ee6b0", accent2: "#7a6bff", panel: "#0f3139", grid: "#1f4c55", dark: true },
  sunset: { bg1: "#fff7ef", bg2: "#ffe1cf", ink: "#2a1812", muted: "#8a6658", accent: "#ff6a3d", accent2: "#e8457c", panel: "#ffffff", grid: "#f2d4c2", dark: false },
  paper: { bg1: "#fbfaf7", bg2: "#e9eef8", ink: "#111318", muted: "#666b76", accent: "#2f63ff", accent2: "#00b3a4", panel: "#ffffff", grid: "#e1e5ee", dark: false },
  ocean: { bg1: "#021627", bg2: "#063a63", ink: "#eef8ff", muted: "#95bad6", accent: "#36c6ff", accent2: "#5ef0c8", panel: "#0a3558", grid: "#194b74", dark: true },
  noir: { bg1: "#0b0b0d", bg2: "#1d1c22", ink: "#f6f5f2", muted: "#a3a2a8", accent: "#ffcf5c", accent2: "#ff7a59", panel: "#1e1e24", grid: "#303038", dark: true },
  neon: { bg1: "#05010d", bg2: "#1a0630", ink: "#fbf4ff", muted: "#b8a3d1", accent: "#ff2fd6", accent2: "#22e5ff", panel: "#1c0a33", grid: "#3a1a5e", dark: true },
  forest: { bg1: "#06140c", bg2: "#123222", ink: "#effff3", muted: "#9fc4ac", accent: "#9be15d", accent2: "#00c2a8", panel: "#113222", grid: "#24503a", dark: true },
  royal: { bg1: "#120a24", bg2: "#2b1650", ink: "#fbf7ff", muted: "#b9a9d6", accent: "#f5c451", accent2: "#c87bff", panel: "#24133f", grid: "#3e2a66", dark: true },
  mono: { bg1: "#ffffff", bg2: "#f1f1ef", ink: "#0d0d0d", muted: "#6b6b6b", accent: "#0d0d0d", accent2: "#5b5b5b", panel: "#ffffff", grid: "#e4e4e1", dark: false },
};

const clean = (v: unknown, max: number): string =>
  typeof v === "string"
    ? Array.from(v.replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim())
        .slice(0, max)
        .join("")
    : "";

/** Keep an icon to one emoji / symbol (models sometimes write words). */
const icon = (v: unknown): string => {
  const s = clean(v, 8);
  const m = s.match(/\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*/u);
  return m ? m[0] : "";
};

export function hashTheme(seed: string): SlideThemeName {
  let h = 0;
  for (const ch of seed) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return SLIDE_THEMES[h % SLIDE_THEMES.length] ?? "midnight";
}

/** Parse and validate a slide spec; undefined when there's nothing to show. */
export function parseSlide(data: string | undefined): SlideSpec | undefined {
  if (!data) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const rawTitle = clean(r.title, 140);
  const title = r.layout === "statement" ? rawTitle : rawTitle.replace(/\*/g, "");
  if (!title.replace(/\*/g, "")) return undefined;
  const items: SlideItem[] = (Array.isArray(r.items) ? r.items : []).slice(0, 6).flatMap((x): SlideItem[] => {
    if (typeof x === "string") return [{ icon: "", title: clean(x, 80), text: "", value: "" }];
    if (typeof x !== "object" || x === null) return [];
    const o = x as Record<string, unknown>;
    const t = clean(o.title, 80);
    const text = clean(o.text, 260);
    return t || text ? [{ icon: icon(o.icon), title: t, text, value: clean(typeof o.value === "number" ? String(o.value) : o.value, 16) }] : [];
  });
  const stats = (Array.isArray(r.stats) ? r.stats : []).slice(0, 4).flatMap((x): SlideStat[] => {
    if (typeof x !== "object" || x === null) return [];
    const o = x as Record<string, unknown>;
    const value = clean(typeof o.value === "number" ? String(o.value) : o.value, 12);
    const label = clean(o.label, 60);
    return value && label ? [{ value, label, delta: clean(o.delta, 14) }] : [];
  });
  const q = typeof r.quote === "object" && r.quote !== null ? (r.quote as Record<string, unknown>) : {};
  const columns = (Array.isArray(r.columns) ? r.columns : []).slice(0, 2).flatMap((c) => {
    if (typeof c !== "object" || c === null) return [];
    const o = c as Record<string, unknown>;
    const list = (Array.isArray(o.items) ? o.items : []).slice(0, 5).map((t) => clean(t, 90)).filter(Boolean);
    return list.length > 0 ? [{ title: clean(o.title, 40) || "—", items: list }] : [];
  });
  const chart = r.chart && typeof r.chart === "object" ? parseChart(JSON.stringify(r.chart)) : undefined;
  // Models sometimes put a chart slide's findings under "columns": use them.
  if (r.layout === "chart" && items.length === 0) {
    for (const t of columns[0]?.items ?? []) items.push({ icon: "", title: "", text: t, value: "" });
  }
  let layout = SLIDE_LAYOUTS.includes(r.layout as SlideLayout) ? (r.layout as SlideLayout) : "cards";
  // When a layout's content is missing, a later slide falls back to a bold statement (a
  // second title slide mid-deck looks like a mistake).
  const bare: SlideLayout = typeof r.index === "number" && r.index > 0 ? "statement" : "title";
  // A layout without its content falls back to one that has something to show.
  if (layout === "chart" && !chart) layout = items.length ? "cards" : bare;
  if (layout === "stats" && stats.length === 0) layout = items.length ? "cards" : bare;
  if (layout === "compare" && columns.length < 2) layout = items.length ? "cards" : bare;
  if ((layout === "cards" || layout === "agenda" || layout === "timeline" || layout === "team" || layout === "pricing" || layout === "process" || layout === "matrix") && items.length === 0) layout = stats.length ? "stats" : bare;
  const quoteText = clean(q.text, 240) || (layout === "quote" ? clean(r.subtitle, 240) : "");
  if (layout === "quote" && !quoteText) layout = bare;
  const theme = SLIDE_THEMES.includes(r.theme as SlideThemeName) ? (r.theme as SlideThemeName) : hashTheme(clean(r.deck, 80) || title);
  const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(99, Math.round(v))) : d);
  return {
    theme,
    layout,
    kicker: clean(r.kicker, 40),
    title,
    subtitle: clean(r.subtitle, 260),
    items,
    stats,
    ...(chart ? { chart } : {}),
    quote: { text: quoteText, author: clean(q.author, 60) },
    columns,
    axes: [clean(Array.isArray(r.axes) ? r.axes[0] : "", 40), clean(Array.isArray(r.axes) ? r.axes[1] : "", 40)],
    pending: r.pending === true,
    deck: clean(r.deck, 80),
    index: num(r.index, 0),
    total: num(r.total, 0),
  };
}

export const SLIDE_W = 960;
export const SLIDE_H = 540;

/** Draw a slide as SVG at any size (it's designed at 960×540 and scaled). */
export function slideSvg(spec: SlideSpec, w: number, h: number): string {
  const t = THEMES[spec.theme];
  const P = `s${(uid++).toString(36)}`;
  const out: string[] = [];
  const defs: string[] = [
    `<linearGradient id="${P}bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.bg1}"/><stop offset="1" stop-color="${t.bg2}"/></linearGradient>`,
    `<radialGradient id="${P}g1"><stop offset="0" stop-color="${t.accent}" stop-opacity="${t.dark ? 0.55 : 0.35}"/><stop offset="1" stop-color="${t.accent}" stop-opacity="0"/></radialGradient>`,
    `<radialGradient id="${P}g2"><stop offset="0" stop-color="${t.accent2}" stop-opacity="${t.dark ? 0.45 : 0.3}"/><stop offset="1" stop-color="${t.accent2}" stop-opacity="0"/></radialGradient>`,
    `<linearGradient id="${P}ac" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${t.accent}"/><stop offset="1" stop-color="${t.accent2}"/></linearGradient>`,
    `<linearGradient id="${P}acv" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="${mix(t.accent, "#ffffff", t.dark ? 0.25 : 0)}"/><stop offset="1" stop-color="${t.accent2}"/></linearGradient>`,
    `<pattern id="${P}dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.1" fill="${t.ink}" fill-opacity="${t.dark ? 0.07 : 0.06}"/></pattern>`,
  ];
  out.push(`<rect width="${SLIDE_W}" height="${SLIDE_H}" fill="url(#${P}bg)"/>`);
  out.push(`<rect width="${SLIDE_W}" height="${SLIDE_H}" fill="url(#${P}dots)"/>`);
  // Soft light blobs; where they sit depends on the layout so a deck doesn't look stamped.
  const glow = (spec.index * 137) % 360;
  const gx = spec.layout === "title" || spec.layout === "closing" ? 760 : 860 + Math.cos(glow) * 40;
  out.push(`<g class="a-drift"><circle cx="${n1(gx)}" cy="${n1(spec.layout === "title" ? 250 : 40)}" r="${spec.layout === "title" ? 380 : 300}" fill="url(#${P}g1)" ${anim("a-glow", 0)}/></g>`);
  out.push(`<g class="a-drift2"><circle cx="${n1(60 + Math.sin(glow) * 30)}" cy="560" r="300" fill="url(#${P}g2)" ${anim("a-glow", 200)}/></g>`);

  const ctx: SCtx = { spec, t, P, out, defs };
  if (spec.pending) {
    drawPending(ctx);
    footer(ctx);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${n1(w)}" height="${n1(h)}" viewBox="0 0 ${SLIDE_W} ${SLIDE_H}" preserveAspectRatio="xMidYMid slice" font-family="${FONT}"><defs>${defs.join("")}</defs>${out.join("")}</svg>`;
  }
  switch (spec.layout) {
    case "title":
      drawTitle(ctx);
      break;
    case "closing":
      drawClosing(ctx);
      break;
    case "statement":
      drawStatement(ctx);
      break;
    default:
      header(ctx);
      if (spec.layout === "agenda") drawAgenda(ctx);
      else if (spec.layout === "cards") drawCards(ctx);
      else if (spec.layout === "stats") drawStats(ctx);
      else if (spec.layout === "chart") drawChart(ctx);
      else if (spec.layout === "quote") drawQuote(ctx);
      else if (spec.layout === "timeline") drawTimeline(ctx);
      else if (spec.layout === "team") drawTeam(ctx);
      else if (spec.layout === "pricing") drawPricing(ctx);
      else if (spec.layout === "process") drawProcess(ctx);
      else if (spec.layout === "matrix") drawMatrix(ctx);
      else drawCompare(ctx);
  }
  footer(ctx);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n1(w)}" height="${n1(h)}" viewBox="0 0 ${SLIDE_W} ${SLIDE_H}" preserveAspectRatio="xMidYMid slice" font-family="${FONT}"><defs>${defs.join("")}</defs><clipPath id="${P}clip"><rect width="${SLIDE_W}" height="${SLIDE_H}" rx="6"/></clipPath><g clip-path="url(#${P}clip)">${out.join("")}</g></svg>`;
}

let uid = 0;

interface SCtx {
  readonly spec: SlideSpec;
  readonly t: SlideTheme;
  readonly P: string;
  readonly out: string[];
  readonly defs: string[];
}

const PAD = 64;
/** Where content starts under the header (set by header()). */
let contentTop = 170;

function kickerPill(ctx: SCtx, x: number, y: number, delay: number): number {
  const { spec, t } = ctx;
  const label = `${String(spec.index + 1).padStart(2, "0")}${spec.kicker ? `  ·  ${spec.kicker.toUpperCase()}` : ""}`;
  const size = 11.5;
  const w = textWidth(label, size, 700) * 1.12 + 30;
  ctx.out.push(
    `<g ${anim("a-up", delay)}><rect x="${x}" y="${y}" width="${n1(w)}" height="26" rx="13" fill="${t.accent}" fill-opacity="${t.dark ? 0.16 : 0.12}" stroke="${t.accent}" stroke-opacity="0.45"/><circle cx="${x + 13}" cy="${y + 13}" r="3.5" fill="${t.accent}"/>${textLines([label], x + 23, y + 17.2, { size, fill: t.dark ? mix(t.accent, "#ffffff", 0.45) : t.accent, weight: 700, letterSpacing: 1.2 })}</g>`,
  );
  return w;
}

function header(ctx: SCtx): void {
  const { spec, t, out } = ctx;
  kickerPill(ctx, PAD, 44, 0);
  const width = SLIDE_W - PAD * 2;
  const size = fitSize(spec.title, width, 36, 22, 800, 2);
  const lines = wrapText(spec.title, width, size, 800, 2);
  out.push(textLines(lines, PAD, 104 + size * 0.2, { size, fill: t.ink, weight: 800, lineHeight: size * 1.12, letterSpacing: -0.6, cls: "a-up", delay: 80 }));
  let y = 104 + size * 0.2 + (lines.length - 1) * size * 1.12;
  const showSub = spec.subtitle && spec.layout !== "quote" && spec.layout !== "chart" && spec.layout !== "stats";
  if (showSub) {
    const sub = wrapText(spec.subtitle, width * 0.86, 16, 400, 1);
    out.push(textLines(sub, PAD, y + 32, { size: 16, fill: t.muted, weight: 400, cls: "a-up", delay: 160 }));
    y += 32;
  }
  contentTop = y + 36;
}

function footer(ctx: SCtx): void {
  const { spec, t, P, out } = ctx;
  if (spec.layout === "title") return;
  out.push(`<rect x="${PAD}" y="${SLIDE_H - 34}" width="28" height="3" rx="1.5" fill="url(#${P}ac)"/>`);
  if (spec.deck) out.push(textLines(wrapText(spec.deck, 520, 11, 600, 1), PAD + 40, SLIDE_H - 29.5, { size: 11, fill: t.muted, weight: 600, letterSpacing: 0.3 }));
  if (spec.total > 0) out.push(textLines([`${String(spec.index + 1).padStart(2, "0")} / ${String(spec.total).padStart(2, "0")}`], SLIDE_W - PAD, SLIDE_H - 29.5, { size: 11, fill: t.muted, weight: 700, anchor: "end", letterSpacing: 1 }));
}

function panel(ctx: SCtx, x: number, y: number, w: number, h: number, highlight = false): string {
  const { t } = ctx;
  const stroke = highlight ? `stroke="${t.accent}" stroke-opacity="0.6" stroke-width="1.5"` : `stroke="${t.dark ? "#ffffff" : t.grid}" stroke-opacity="${t.dark ? 0.08 : 1}"`;
  return `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="${n1(h)}" rx="18" fill="${t.panel}" fill-opacity="${t.dark ? 0.72 : 0.92}" ${stroke}/>`;
}

function badge(ctx: SCtx, cx: number, cy: number, r: number, content: string): string {
  const { t, P } = ctx;
  const emoji = /\p{Extended_Pictographic}/u.test(content);
  return `<circle cx="${n1(cx)}" cy="${n1(cy)}" r="${r}" fill="${emoji ? (t.dark ? "#ffffff" : t.accent) : `url(#${P}ac)`}" fill-opacity="${emoji ? 0.1 : 1}"/>${textLines([content], cx, cy + (emoji ? r * 0.36 : r * 0.34), { size: emoji ? r * 1.0 : r * 0.82, fill: emoji ? t.ink : "#ffffff", weight: 800, anchor: "middle" })}`;
}

function drawTitle(ctx: SCtx): void {
  const { spec, t, P, out } = ctx;
  // Art on the right: orbit rings around a glowing sphere, with small satellites.
  const cx = 735;
  const cy = 270;
  defs(ctx, `<radialGradient id="${P}orb" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="${mix(t.accent, "#ffffff", 0.55)}"/><stop offset="0.45" stop-color="${t.accent}"/><stop offset="1" stop-color="${t.accent2}"/></radialGradient>`);
  out.push(`<g class="a-orbit" style="transform-origin:${cx}px ${cy}px">`);
  [190, 140, 92].forEach((r, i) => out.push(`<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * 0.42}" fill="none" stroke="${i === 1 ? `url(#${P}ac)` : t.ink}" stroke-opacity="${i === 1 ? 0.9 : 0.14}" stroke-width="${i === 1 ? 2 : 1.2}" transform="rotate(-18 ${cx} ${cy})"/>`));
  out.push(`<circle cx="${cx}" cy="${cy}" r="64" fill="url(#${P}orb)" ${anim("a-pop", 300)}/>`);
  out.push(`<circle cx="${cx - 22}" cy="${cy - 24}" r="18" fill="#ffffff" fill-opacity="0.25" ${anim("a-pop", 420)}/>`);
  const sats: Array<[number, number, number, string]> = [
    [cx + 176, cy - 40, 9, t.accent2],
    [cx - 128, cy + 52, 7, t.accent],
    [cx + 60, cy + 66, 5, t.ink],
  ];
  sats.forEach(([x, y, r, c], i) => out.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" ${anim("a-pop", 600 + i * 120)}/>`));
  out.push(`</g>`);

  kickerPill(ctx, PAD, 150, 0);
  const width = 520;
  const size = fitSize(spec.title, width, 58, 30, 800, 3);
  const lines = wrapText(spec.title, width, size, 800, 3);
  const top = 212 + size * 0.8;
  out.push(textLines(lines, PAD, top, { size, fill: t.ink, weight: 800, lineHeight: size * 1.06, letterSpacing: -1.4, cls: "a-up", delay: 120 }));
  let y = top + (lines.length - 1) * size * 1.06;
  out.push(`<rect x="${PAD}" y="${n1(y + 26)}" width="96" height="5" rx="2.5" fill="url(#${P}ac)" ${anim("a-growx", 380)}/>`);
  y += 26;
  if (spec.subtitle) {
    const sub = wrapText(spec.subtitle, width, 18, 400, 3);
    out.push(textLines(sub, PAD, y + 44, { size: 18, fill: t.muted, weight: 400, lineHeight: 26, cls: "a-up", delay: 300 }));
  }
  if (spec.deck && spec.deck !== spec.title) out.push(textLines(wrapText(spec.deck.toUpperCase(), 520, 11, 700, 1), PAD, 64, { size: 11, fill: t.muted, weight: 700, letterSpacing: 1.6, cls: "a-fade", delay: 500 }));
}

function defs(ctx: SCtx, d: string): void {
  ctx.defs.push(d);
}

function drawClosing(ctx: SCtx): void {
  const { spec, t, P, out } = ctx;
  const cx = SLIDE_W / 2;
  out.push(`<circle cx="${cx}" cy="250" r="170" fill="none" stroke="${t.ink}" stroke-opacity="0.08"/>`);
  out.push(`<circle cx="${cx}" cy="250" r="240" fill="none" stroke="${t.ink}" stroke-opacity="0.05"/>`);
  const label = spec.kicker ? spec.kicker.toUpperCase() : "NEXT STEPS";
  out.push(textLines([label], cx, 150, { size: 12, fill: t.accent, weight: 800, anchor: "middle", letterSpacing: 2.4, cls: "a-up", delay: 0 }));
  const size = fitSize(spec.title, 760, 52, 28, 800, 2);
  const lines = wrapText(spec.title, 760, size, 800, 2);
  out.push(textLines(lines, cx, 205 + size * 0.5, { size, fill: t.ink, weight: 800, anchor: "middle", lineHeight: size * 1.08, letterSpacing: -1.2, cls: "a-up", delay: 100 }));
  let y = 205 + size * 0.5 + (lines.length - 1) * size * 1.08;
  if (spec.subtitle) {
    const sub = wrapText(spec.subtitle, 640, 17, 400, 2);
    out.push(textLines(sub, cx, y + 42, { size: 17, fill: t.muted, anchor: "middle", lineHeight: 25, cls: "a-up", delay: 220 }));
    y += 42 + (sub.length - 1) * 25;
  }
  const actions = spec.items.slice(0, 3);
  if (actions.length > 0) {
    const widths = actions.map((a) => textWidth(`${a.icon ? `${a.icon} ` : ""}${a.title || a.text}`, 14, 700) + 40);
    const total = widths.reduce((a, b) => a + b, 0) + (actions.length - 1) * 12;
    let x = cx - total / 2;
    actions.forEach((a, i) => {
      const bw = widths[i] ?? 100;
      const primary = i === 0;
      out.push(
        `<g ${anim("a-pop", 420 + i * 120)}><rect x="${n1(x)}" y="${n1(y + 44)}" width="${n1(bw)}" height="44" rx="22" fill="${primary ? `url(#${P}ac)` : "none"}" stroke="${primary ? "none" : t.ink}" stroke-opacity="0.25"/>${textLines([`${a.icon ? `${a.icon} ` : ""}${a.title || a.text}`], x + bw / 2, y + 71, { size: 14, fill: primary ? "#ffffff" : t.ink, weight: 700, anchor: "middle" })}</g>`,
      );
      x += bw + 12;
    });
  }
}

function drawAgenda(ctx: SCtx): void {
  const { spec, t, out } = ctx;
  const items = spec.items.slice(0, 6);
  const cols = items.length > 3 ? 2 : 1;
  const rows = Math.ceil(items.length / cols);
  const colW = (SLIDE_W - PAD * 2 - (cols - 1) * 40) / cols;
  const rowH = Math.min(96, (SLIDE_H - contentTop - 64) / rows);
  items.forEach((item, i) => {
    const c = Math.floor(i / rows);
    const r = i % rows;
    const x = PAD + c * (colW + 40);
    const y = contentTop + r * rowH;
    const num = String(i + 1).padStart(2, "0");
    const parts = [
      textLines([num], x, y + 30, { size: 30, fill: t.accent, weight: 800, letterSpacing: -1 }),
      textLines(wrapText(item.title || item.text, colW - 70, 18, 700, 1), x + 62, y + 18, { size: 18, fill: t.ink, weight: 700 }),
    ];
    if (item.title && item.text) parts.push(textLines(wrapText(item.text, colW - 70, 13.5, 400, 2), x + 62, y + 40, { size: 13.5, fill: t.muted, lineHeight: 19 }));
    parts.push(`<line x1="${x}" x2="${n1(x + colW)}" y1="${n1(y + rowH - 12)}" y2="${n1(y + rowH - 12)}" stroke="${t.ink}" stroke-opacity="0.09"/>`);
    out.push(`<g ${anim("a-left", 200 + i * 110)}>${parts.join("")}</g>`);
  });
}

function drawCards(ctx: SCtx): void {
  const { spec, t, out } = ctx;
  const items = spec.items.slice(0, 6);
  const n = items.length;
  const cols = n <= 3 ? n : n === 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const gap = 18;
  const areaH = SLIDE_H - contentTop - 62;
  const cw = (SLIDE_W - PAD * 2 - gap * (cols - 1)) / cols;
  const ch = Math.min(rows === 1 ? 250 : 150, (areaH - gap * (rows - 1)) / rows);
  const wide = cols <= 2 && rows > 1;
  items.forEach((item, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = PAD + c * (cw + gap);
    const y = contentTop + r * (ch + gap);
    const mark = item.icon || String(i + 1);
    const parts = [panel(ctx, x, y, cw, ch)];
    if (wide) {
      // Icon on the left, text on the right.
      parts.push(badge(ctx, x + 40, y + 42, 20, mark));
      const tw = cw - 92;
      const titleLines = wrapText(item.title, tw, 17, 700, 1);
      parts.push(textLines(titleLines, x + 76, y + 40, { size: 17, fill: t.ink, weight: 700 }));
      const maxLines = Math.max(1, Math.floor((ch - 64) / 19));
      if (item.text) parts.push(textLines(wrapText(item.text, tw, 13.5, 400, maxLines), x + 76, y + 64, { size: 13.5, fill: t.muted, lineHeight: 19 }));
    } else {
      parts.push(badge(ctx, x + 42, y + 44, 21, mark));
      const tw = cw - 44;
      const titleLines = wrapText(item.title, tw, 18, 700, 2);
      parts.push(textLines(titleLines, x + 22, y + 98, { size: 18, fill: t.ink, weight: 700, lineHeight: 22 }));
      const ty = y + 98 + (titleLines.length - 1) * 22 + 26;
      const maxLines = Math.max(1, Math.floor((y + ch - 18 - ty) / 19) + 1);
      if (item.text) parts.push(textLines(wrapText(item.text, tw, 13.5, 400, maxLines), x + 22, ty, { size: 13.5, fill: t.muted, lineHeight: 19 }));
    }
    out.push(`<g ${anim("a-up", 220 + i * 110)}>${parts.join("")}</g>`);
  });
}

function drawStats(ctx: SCtx): void {
  const { spec, t, P, out } = ctx;
  const stats = spec.stats;
  const hero = stats[0];
  if (stats.length === 1 && hero) {
    const size = fitSize(hero.value, 700, 170, 60, 800, 1);
    out.push(textLines([hero.value], PAD - 6, contentTop + size * 0.82 + 6, { size, fill: `url(#${P}acv)`, weight: 800, letterSpacing: -6, cls: "a-pop", delay: 200 }));
    const y = contentTop + size * 0.82 + 54;
    out.push(textLines(wrapText(hero.label, 620, 22, 600, 2), PAD, y, { size: 22, fill: t.ink, weight: 600, lineHeight: 28, cls: "a-up", delay: 420 }));
    if (hero.delta) out.push(textLines([hero.delta], SLIDE_W - PAD, contentTop + 40, { size: 20, fill: deltaTone(hero.delta) === "down" ? (t.dark ? "#ff6b61" : "#d6453d") : t.dark ? "#3ddc8b" : "#13915a", weight: 800, anchor: "end", cls: "a-pop", delay: 600 }));
    if (spec.subtitle) out.push(textLines(wrapText(spec.subtitle, 760, 16, 400, 2), PAD, y + 62, { size: 16, fill: t.muted, lineHeight: 22, cls: "a-up", delay: 560 }));
    return;
  }
  const n = stats.length;
  const gap = 20;
  const cw = (SLIDE_W - PAD * 2 - gap * (n - 1)) / n;
  const hasSub = Boolean(spec.subtitle);
  const ch = hasSub ? 210 : 260;
  const y = contentTop + 4;
  // One size for every number, so the row reads as a set.
  const size = Math.min(...stats.map((st) => fitSize(st.value, cw - 44, n <= 2 ? 76 : n === 3 ? 62 : 50, 26, 800, 1)));
  stats.forEach((st, i) => {
    const x = PAD + i * (cw + gap);
    const tone = deltaTone(st.delta);
    const deltaColor = tone === "up" ? (t.dark ? "#3ddc8b" : "#13915a") : tone === "down" ? (t.dark ? "#ff6b61" : "#d6453d") : t.muted;
    const parts = [panel(ctx, x, y, cw, ch)];
    parts.push(textLines([st.value], x + 24, y + 30 + size * 0.86, { size, fill: `url(#${P}acv)`, weight: 800, letterSpacing: -1.5 }));
    const labelY = y + 30 + size * 0.86 + 34;
    parts.push(textLines(wrapText(st.label, cw - 48, 15, 500, 3), x + 24, labelY, { size: 15, fill: t.ink, weight: 600, lineHeight: 20 }));
    if (st.delta) {
      const dw = textWidth(st.delta, 12, 700) + 22;
      parts.push(`<rect x="${n1(x + 24)}" y="${n1(y + ch - 46)}" width="${n1(dw)}" height="24" rx="12" fill="${deltaColor}" fill-opacity="0.16"/>`);
      parts.push(textLines([st.delta], x + 24 + dw / 2, y + ch - 29.5, { size: 12, fill: deltaColor, weight: 700, anchor: "middle" }));
    }
    out.push(`<g ${anim("a-up", 200 + i * 140)}>${parts.join("")}</g>`);
  });
  if (hasSub) {
    const sy = y + ch + 28;
    out.push(`<g ${anim("a-up", 300 + n * 140)}><rect x="${PAD}" y="${n1(sy)}" width="4" height="40" rx="2" fill="url(#${P}acv)"/>${textLines(wrapText(spec.subtitle, SLIDE_W - PAD * 2 - 30, 16, 500, 2), PAD + 22, sy + 16, { size: 16, fill: t.ink, weight: 500, lineHeight: 22 })}</g>`);
  }
}

function chartTheme(t: SlideTheme): ChartTheme {
  return { ink: t.ink, muted: t.muted, grid: t.dark ? mix(t.bg2, "#ffffff", 0.12) : t.grid, card: t.dark ? mix(t.bg1, t.bg2, 0.5) : t.bg1, panel: t.dark ? mix(t.panel, "#ffffff", 0.04) : mix(t.bg2, "#ffffff", 0.4), up: t.dark ? "#3ddc8b" : "#13915a", down: t.dark ? "#ff6b61" : "#d6453d" };
}

function drawChart(ctx: SCtx): void {
  const { spec, t, P, out } = ctx;
  const chart = spec.chart;
  if (!chart) return;
  const side = spec.items.length > 0 || spec.subtitle;
  const cw = side ? 560 : SLIDE_W - PAD * 2;
  const chH = SLIDE_H - contentTop - 58;
  const inner = chartSvg({ ...chart, title: "", note: "", insight: "", kpis: [] }, cw, chH, chartTheme(t), false);
  out.push(`<g ${anim("a-fade", 150)}>${inner.replace("<svg ", `<svg x="${PAD}" y="${n1(contentTop)}" `)}</g>`);
  if (!side) return;
  const x = PAD + cw + 36;
  const w = SLIDE_W - PAD - x;
  let y = contentTop + 6;
  if (spec.subtitle) {
    const lines = wrapText(spec.subtitle, w - 34, 15, 600, 4);
    const hh = lines.length * 21 + 30;
    out.push(`<g ${anim("a-left", 600)}>${panel(ctx, x, y, w, hh)}<rect x="${n1(x)}" y="${n1(y + 14)}" width="4" height="${n1(hh - 28)}" rx="2" fill="url(#${P}acv)"/>${textLines(lines, x + 20, y + 26, { size: 15, fill: t.ink, weight: 600, lineHeight: 21 })}</g>`);
    y += hh + 16;
  }
  spec.items.slice(0, 3).forEach((item, i) => {
    if (y > SLIDE_H - 110) return;
    const lines = wrapText(item.text || item.title, w - 44, 13, 400, 3);
    const parts = [badge(ctx, x + 14, y + 12, 12, item.icon || String(i + 1))];
    if (item.title && item.text) parts.push(textLines(wrapText(item.title, w - 40, 14, 700, 1), x + 36, y + 17, { size: 14, fill: t.ink, weight: 700 }));
    parts.push(textLines(lines, x + 36, y + (item.title && item.text ? 38 : 17), { size: 13, fill: t.muted, lineHeight: 18 }));
    out.push(`<g ${anim("a-left", 750 + i * 120)}>${parts.join("")}</g>`);
    y += (item.title && item.text ? 30 : 10) + lines.length * 18 + 16;
  });
}

function drawQuote(ctx: SCtx): void {
  const { spec, t, P, out } = ctx;
  const text = spec.quote.text;
  out.push(textLines(["“"], PAD - 6, contentTop + 120, { size: 150, fill: `url(#${P}ac)`, weight: 800, cls: "a-pop", delay: 100 }));
  const size = fitSize(text, SLIDE_W - PAD * 2 - 80, 34, 20, 600, 4);
  const lines = wrapText(text, SLIDE_W - PAD * 2 - 80, size, 600, 4);
  out.push(textLines(lines, PAD + 80, contentTop + 52 + size, { size, fill: t.ink, weight: 600, lineHeight: size * 1.3, letterSpacing: -0.4, cls: "a-up", delay: 220 }));
  const ay = contentTop + 52 + size + (lines.length - 1) * size * 1.3 + 44;
  if (spec.quote.author) out.push(`<g ${anim("a-up", 420)}><rect x="${PAD + 80}" y="${n1(ay - 5)}" width="28" height="2.5" fill="${t.accent}"/>${textLines([spec.quote.author], PAD + 120, ay, { size: 15, fill: t.muted, weight: 700 })}</g>`);
}

function drawTimeline(ctx: SCtx): void {
  const { spec, t, P, out } = ctx;
  const items = spec.items.slice(0, 6);
  const n = items.length;
  const gap = 22;
  const colW = (SLIDE_W - PAD * 2 - gap * (n - 1)) / n;
  // Center the band vertically in the space under the title.
  const lineY = contentTop + 46 + Math.max(0, (SLIDE_H - contentTop - 60 - 250) / 2);
  const dotX = (i: number): number => PAD + i * (colW + gap) + 8;
  const x1 = n > 1 ? dotX(n - 1) : SLIDE_W - PAD;
  out.push(`<line x1="${PAD}" x2="${SLIDE_W - PAD}" y1="${lineY}" y2="${lineY}" stroke="${t.ink}" stroke-opacity="0.12" stroke-width="2"/>`);
  out.push(`<line x1="${PAD + 8}" x2="${n1(x1)}" y1="${lineY}" y2="${lineY}" stroke="url(#${P}ac)" stroke-width="3" stroke-linecap="round" pathLength="1" ${anim("a-draw", 150)}/>`);
  items.forEach((item, i) => {
    const cx = dotX(i);
    const x = PAD + i * (colW + gap);
    const titleLines = wrapText(item.title, colW, 16, 700, 2);
    const parts = [
      `<circle cx="${n1(cx)}" cy="${lineY}" r="15" fill="${t.accent}" fill-opacity="0.18"/>`,
      `<circle cx="${n1(cx)}" cy="${lineY}" r="7" fill="${i === 0 ? t.accent : t.dark ? t.ink : t.accent2}"/>`,
      textLines([item.icon ? item.icon : `STEP ${i + 1}`], x, lineY - 30, { size: item.icon ? 22 : 11, fill: t.accent, weight: 800, letterSpacing: item.icon ? 0 : 1.6 }),
      textLines(titleLines, x, lineY + 48, { size: 16, fill: t.ink, weight: 700, lineHeight: 20 }),
    ];
    if (item.text) parts.push(textLines(wrapText(item.text, colW, 13, 400, 7 - titleLines.length), x, lineY + 52 + titleLines.length * 20 + 8, { size: 13, fill: t.muted, lineHeight: 18 }));
    out.push(`<g ${anim("a-up", 300 + i * 160)}>${parts.join("")}</g>`);
  });
}

function drawCompare(ctx: SCtx): void {
  const { spec, t, P, out } = ctx;
  const [a, b] = spec.columns;
  if (!a || !b) return;
  const gap = 24;
  const cw = (SLIDE_W - PAD * 2 - gap) / 2;
  const ch = SLIDE_H - contentTop - 62;
  const y = contentTop;
  [a, b].forEach((col, k) => {
    const x = PAD + k * (cw + gap);
    const good = k === 1;
    const parts = [panel(ctx, x, y, cw, ch, good)];
    if (good) parts.push(`<rect x="${n1(x)}" y="${n1(y)}" width="${n1(cw)}" height="4" rx="2" fill="url(#${P}ac)"/>`);
    parts.push(textLines([col.title.toUpperCase()], x + 26, y + 38, { size: 13, fill: good ? t.accent : t.muted, weight: 800, letterSpacing: 1.6 }));
    const rowH = Math.min(56, (ch - 70) / Math.max(1, col.items.length));
    col.items.forEach((item, i) => {
      const iy = y + 64 + i * rowH;
      parts.push(`<circle cx="${n1(x + 36)}" cy="${n1(iy + 8)}" r="11" fill="${good ? t.accent : t.muted}" fill-opacity="${good ? 0.2 : 0.14}"/>`);
      parts.push(good ? `<path d="M${n1(x + 31)},${n1(iy + 8)} l3.5,3.5 l6.5,-7" fill="none" stroke="${t.accent}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>` : `<path d="M${n1(x + 32)},${n1(iy + 4)} l8,8 M${n1(x + 40)},${n1(iy + 4)} l-8,8" stroke="${t.muted}" stroke-width="2" stroke-linecap="round"/>`);
      parts.push(textLines(wrapText(item, cw - 86, 15, good ? 600 : 400, 2), x + 58, iy + 13, { size: 15, fill: good ? t.ink : t.muted, weight: good ? 600 : 400, lineHeight: 19 }));
    });
    out.push(`<g ${anim(k === 0 ? "a-left" : "a-right", 220 + k * 220)}>${parts.join("")}</g>`);
  });
}

/** Turn a spec into the JSON a slide shape stores. */
export function slideData(spec: Partial<Omit<SlideSpec, "chart">> & { title: string; chart?: unknown }): string {
  return JSON.stringify(spec);
}

/** One giant idea; words wrapped in *asterisks* get the accent gradient. */
function drawStatement(ctx: SCtx): void {
  const { spec, t, P, out } = ctx;
  const words: Array<{ w: string; hi: boolean }> = [];
  let hi = false;
  for (const token of spec.title.split(/\s+/).filter(Boolean)) {
    const starts = token.startsWith("*");
    const ends = token.endsWith("*") && token.length > 1;
    if (starts) hi = true;
    words.push({ w: token.replace(/\*/g, ""), hi });
    if (ends || (starts && token.length > 1 && token.endsWith("*"))) hi = false;
  }
  const plain = words.map((x) => x.w).join(" ");
  const maxW = SLIDE_W - PAD * 2 - 40;
  const size = fitSize(plain, maxW, 68, 34, 800, 3);
  // Wrap by words, keeping each word's highlight.
  const lines: Array<typeof words> = [];
  let line: typeof words = [];
  for (const word of words) {
    const next = [...line, word].map((x) => x.w).join(" ");
    if (line.length > 0 && textWidth(next, size, 800) > maxW) {
      lines.push(line);
      line = [word];
    } else line.push(word);
  }
  if (line.length > 0) lines.push(line);
  const lh = size * 1.08;
  const top = SLIDE_H / 2 - ((lines.length - 1) * lh) / 2 - (spec.subtitle ? 26 : 0);
  if (spec.kicker) out.push(textLines([spec.kicker.toUpperCase()], SLIDE_W / 2, top - size - 6, { size: 13, fill: t.accent, weight: 800, anchor: "middle", letterSpacing: 2.6, cls: "a-up", delay: 0 }));
  lines.slice(0, 3).forEach((ws, i) => {
    const spans = ws.map((x, k) => `<tspan${x.hi ? ` fill="url(#${P}ac)"` : ""}>${(k ? " " : "") + x.w.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</tspan>`).join("");
    out.push(`<text x="${SLIDE_W / 2}" y="${n1(top + i * lh + size * 0.35)}" text-anchor="middle" font-family="${FONT}" font-size="${n1(size)}" font-weight="800" letter-spacing="-1.6" fill="${t.ink}" ${anim("a-up", 120 + i * 140)}>${spans}</text>`);
  });
  if (spec.subtitle) out.push(textLines(wrapText(spec.subtitle, 680, 18, 400, 2), SLIDE_W / 2, top + (Math.min(3, lines.length) - 1) * lh + size * 0.35 + 54, { size: 18, fill: t.muted, anchor: "middle", lineHeight: 26, cls: "a-up", delay: 520 }));
}

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

function drawTeam(ctx: SCtx): void {
  const { spec, t, P, out } = ctx;
  const people = spec.items.slice(0, 6);
  const n = people.length;
  const cols = n <= 4 ? n : 3;
  const rows = Math.ceil(n / cols);
  const cw = (SLIDE_W - PAD * 2) / cols;
  const rh = Math.min(200, (SLIDE_H - contentTop - 60) / rows);
  people.forEach((p, i) => {
    const cx = PAD + (i % cols) * cw + cw / 2;
    const y = contentTop + Math.floor(i / cols) * rh;
    const r = rows > 1 ? 34 : 48;
    const parts = [
      `<circle cx="${n1(cx)}" cy="${n1(y + r + 4)}" r="${r + 5}" fill="none" stroke="url(#${P}ac)" stroke-width="2"/>`,
      `<circle cx="${n1(cx)}" cy="${n1(y + r + 4)}" r="${r}" fill="url(#${P}acv)"/>`,
      textLines([p.icon || initials(p.title) || "•"], cx, y + r + 4 + (p.icon ? r * 0.36 : r * 0.3), { size: p.icon ? r * 0.95 : r * 0.78, fill: "#ffffff", weight: 800, anchor: "middle" }),
      textLines(wrapText(p.title, cw - 24, 17, 700, 1), cx, y + r * 2 + 34, { size: 17, fill: t.ink, weight: 700, anchor: "middle" }),
    ];
    if (p.value) parts.push(textLines([p.value.toUpperCase()], cx, y + r * 2 + 54, { size: 11, fill: t.accent, weight: 800, anchor: "middle", letterSpacing: 1.4 }));
    if (p.text) parts.push(textLines(wrapText(p.text, cw - 30, 12.5, 400, rows > 1 ? 2 : 3), cx, y + r * 2 + (p.value ? 74 : 56), { size: 12.5, fill: t.muted, anchor: "middle", lineHeight: 17 }));
    out.push(`<g ${anim("a-pop", 200 + i * 110)}>${parts.join("")}</g>`);
  });
}

function drawPricing(ctx: SCtx): void {
  const { spec, t, P, out } = ctx;
  const plans = spec.items.slice(0, 4);
  const n = plans.length;
  const gap = 18;
  const cw = (SLIDE_W - PAD * 2 - gap * (n - 1)) / n;
  const best = n >= 3 ? 1 : n - 1;
  plans.forEach((plan, i) => {
    const pop = i === best;
    const x = PAD + i * (cw + gap);
    const y = contentTop + (pop ? -8 : 6);
    const h = SLIDE_H - contentTop - (pop ? 50 : 64);
    const parts = [panel(ctx, x, y, cw, h, pop)];
    if (pop) {
      parts.push(`<rect x="${n1(x)}" y="${n1(y)}" width="${n1(cw)}" height="5" rx="2.5" fill="url(#${P}ac)"/>`);
      const label = "MOST POPULAR";
      const lw = textWidth(label, 10, 800) * 1.15 + 20;
      parts.push(`<rect x="${n1(x + cw - lw - 14)}" y="${n1(y + 16)}" width="${n1(lw)}" height="20" rx="10" fill="url(#${P}ac)"/>`);
      parts.push(textLines([label], x + cw - 14 - lw / 2, y + 29.5, { size: 10, fill: "#ffffff", weight: 800, anchor: "middle", letterSpacing: 1 }));
    }
    parts.push(textLines(wrapText(`${plan.icon ? `${plan.icon} ` : ""}${plan.title}`, cw - 40, 16, 700, 1), x + 22, y + 32, { size: 16, fill: t.ink, weight: 700 }));
    const price = plan.value || "—";
    const ps = fitSize(price, cw - 44, 40, 20, 800, 1);
    parts.push(textLines([price], x + 22, y + 46 + ps * 0.9, { size: ps, fill: pop ? `url(#${P}acv)` : t.ink, weight: 800, letterSpacing: -1 }));
    const features = plan.text.split(/[;•\n]|,\s(?=[A-Z0-9₹$])/).map((f) => f.trim()).filter(Boolean).slice(0, 6);
    let fy = y + 46 + ps + 34;
    for (const f of features) {
      if (fy > y + h - 20) break;
      const lines = wrapText(f, cw - 66, 13, 500, 2);
      parts.push(`<circle cx="${n1(x + 31)}" cy="${n1(fy - 4)}" r="8" fill="${t.accent}" fill-opacity="0.18"/><path d="M${n1(x + 27.5)},${n1(fy - 4)} l2.5,2.5 l4.5,-5" fill="none" stroke="${t.accent}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`);
      parts.push(textLines(lines, x + 46, fy, { size: 13, fill: t.ink, weight: 500, lineHeight: 17 }));
      fy += lines.length * 17 + 12;
    }
    out.push(`<g ${anim("a-up", 200 + i * 130)}>${parts.join("")}</g>`);
  });
}

function drawProcess(ctx: SCtx): void {
  const { spec, t, P, out } = ctx;
  const steps = spec.items.slice(0, 6);
  const n = steps.length;
  const gap = 8;
  const cw = (SLIDE_W - PAD * 2 - gap * (n - 1)) / n;
  const y = contentTop + 6;
  const ah = 74;
  const tip = 22;
  steps.forEach((st, i) => {
    const x = PAD + i * (cw + gap);
    const first = i === 0;
    const last = i === n - 1;
    const pts = [
      [x, y],
      [x + cw - (last ? 0 : tip), y],
      [x + cw + (last ? 0 : 0), y + ah / 2],
      [x + cw - (last ? 0 : tip), y + ah],
      [x, y + ah],
      [x + (first ? 0 : tip), y + ah / 2],
    ];
    if (last) {
      pts[1] = [x + cw, y];
      pts[2] = [x + cw, y + ah / 2];
      pts[3] = [x + cw, y + ah];
    }
    const k = n > 1 ? i / (n - 1) : 0;
    const fill = mix(t.accent, t.accent2, k);
    const parts = [
      `<polygon points="${pts.map(([a, b]) => `${n1(a ?? 0)},${n1(b ?? 0)}`).join(" ")}" fill="${fill}" fill-opacity="${t.dark ? 0.9 : 0.95}"/>`,
      textLines([st.icon || String(i + 1).padStart(2, "0")], x + (first ? 16 : tip + 8), y + ah / 2 + 8, { size: st.icon ? 22 : 20, fill: "#ffffff", weight: 800 }),
      textLines(wrapText(st.value || `Step ${i + 1}`, cw - 70, 11, 800, 1), x + (first ? 16 : tip + 8) + 40, y + ah / 2 + 4, { size: 11, fill: "#ffffff", weight: 800, letterSpacing: 1, opacity: 0.9 }),
      textLines(wrapText(st.title, cw - 12, 16, 700, 2), x + 6, y + ah + 34, { size: 16, fill: t.ink, weight: 700, lineHeight: 20 }),
    ];
    const tl = wrapText(st.title, cw - 12, 16, 700, 2).length;
    if (st.text) parts.push(textLines(wrapText(st.text, cw - 12, 12.5, 400, 6), x + 6, y + ah + 34 + tl * 20 + 6, { size: 12.5, fill: t.muted, lineHeight: 17 }));
    out.push(`<g ${anim("a-left", 200 + i * 140)}>${parts.join("")}</g>`);
    void P;
  });
}

function drawMatrix(ctx: SCtx): void {
  const { spec, t, P, out } = ctx;
  const quads = spec.items.slice(0, 4);
  const x0 = PAD + 34;
  const y0 = contentTop;
  const w = SLIDE_W - PAD - x0;
  const h = SLIDE_H - contentTop - 76;
  const qw = w / 2;
  const qh = h / 2;
  // Axes.
  out.push(`<line x1="${x0}" y1="${n1(y0 + h)}" x2="${n1(x0 + w)}" y2="${n1(y0 + h)}" stroke="${t.ink}" stroke-opacity="0.35" stroke-width="1.5"/>`);
  out.push(`<line x1="${x0}" y1="${n1(y0 + h)}" x2="${x0}" y2="${n1(y0)}" stroke="${t.ink}" stroke-opacity="0.35" stroke-width="1.5"/>`);
  const [ax, ay] = spec.axes;
  if (ax) out.push(textLines([`${ax.toUpperCase()} →`], x0 + w, y0 + h + 22, { size: 11, fill: t.muted, weight: 800, anchor: "end", letterSpacing: 1.4 }));
  if (ay) out.push(`<text transform="translate(${PAD + 12} ${n1(y0)}) rotate(-90)" text-anchor="end" font-family="${FONT}" font-size="11" font-weight="800" letter-spacing="1.4" fill="${t.muted}">${ay.toUpperCase().replace(/&/g, "&amp;").replace(/</g, "&lt;")} →</text>`);
  // Top-right is the winner quadrant.
  const order: Array<[number, number]> = [
    [1, 0],
    [0, 0],
    [1, 1],
    [0, 1],
  ];
  quads.forEach((q, i) => {
    const [cx, cy] = order[i] ?? [0, 0];
    const x = x0 + 8 + cx * qw;
    const y = y0 + cy * qh;
    const win = i === 0;
    const parts = [
      `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(qw - 12)}" height="${n1(qh - 10)}" rx="16" fill="${win ? t.accent : t.panel}" fill-opacity="${win ? 0.16 : t.dark ? 0.55 : 0.9}" stroke="${win ? t.accent : t.grid}" stroke-opacity="${win ? 0.7 : 1}"/>`,
      textLines([`${q.icon ? `${q.icon}  ` : ""}${q.title}`], x + 18, y + 32, { size: 17, fill: win ? (t.dark ? mix(t.accent, "#ffffff", 0.35) : t.accent) : t.ink, weight: 800 }),
    ];
    if (q.text) parts.push(textLines(wrapText(q.text, qw - 50, 13, 400, Math.max(1, Math.floor((qh - 60) / 18))), x + 18, y + 56, { size: 13, fill: t.muted, lineHeight: 18 }));
    out.push(`<g ${anim("a-pop", 200 + i * 130)}>${parts.join("")}</g>`);
    void P;
  });
}

/** A slide the AI hasn't written yet: its title, what it will show, and skeleton blocks. */
function drawPending(ctx: SCtx): void {
  const { spec, t, P, out } = ctx;
  header(ctx);
  const y = contentTop;
  const w = SLIDE_W - PAD * 2;
  const blocks: Array<[number, number, number, number]> =
    spec.layout === "stats" || spec.layout === "pricing" || spec.layout === "team"
      ? [0, 1, 2].map((i) => [PAD + i * (w / 3), y, w / 3 - 18, 190] as [number, number, number, number])
      : spec.layout === "chart"
        ? [
            [PAD, y, w * 0.6, 260],
            [PAD + w * 0.64, y, w * 0.36, 120],
          ]
        : [0, 1, 2, 3].map((i) => [PAD + (i % 2) * (w / 2), y + Math.floor(i / 2) * 110, w / 2 - 18, 92] as [number, number, number, number]);
  defs(ctx, `<linearGradient id="${P}sh" x1="0" x2="1"><stop offset="0" stop-color="${t.ink}" stop-opacity="0.04"/><stop offset="0.5" stop-color="${t.ink}" stop-opacity="0.12"/><stop offset="1" stop-color="${t.ink}" stop-opacity="0.04"/></linearGradient>`);
  blocks.forEach(([x, by, bw, bh]) => {
    out.push(`<rect x="${n1(x)}" y="${n1(by)}" width="${n1(bw)}" height="${n1(bh)}" rx="16" fill="url(#${P}sh)" class="a-shimmer"/>`);
  });
  out.push(textLines(["\u2726  Writing this slide\u2026"], SLIDE_W - PAD, SLIDE_H - 62, { size: 13, fill: t.accent, weight: 700, anchor: "end" }));
}

