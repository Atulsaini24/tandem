/**
 * Charts on the canvas. A chart shape stores a small JSON spec; this module validates it
 * (it may come from the AI or another user, so it's untrusted) and draws it as a designed
 * SVG card: header, KPI tiles, the plot, and an insight callout. The renderer rasterizes
 * that SVG, export embeds it, and the reveal overlay animates the very same markup.
 */
import { anim, arcPath, deltaTone, esc, fitSize, FONT, mix, n1, smoothPath, textLines, textWidth, wrapText } from "./svg-kit";

export type ChartType = "bar" | "hbar" | "stacked" | "line" | "area" | "pie" | "donut" | "funnel" | "radar";
export const CHART_TYPES: readonly ChartType[] = ["bar", "hbar", "stacked", "line", "area", "pie", "donut", "funnel", "radar"];
export const CHART_TYPE_NAMES: Record<ChartType, string> = {
  bar: "Bar",
  hbar: "Ranking",
  stacked: "Stacked",
  line: "Line",
  area: "Area",
  pie: "Pie",
  donut: "Donut",
  funnel: "Funnel",
  radar: "Radar",
};

export interface Kpi {
  readonly label: string;
  readonly value: string;
  readonly delta: string;
}

export interface ChartSpec {
  readonly type: ChartType;
  readonly title: string;
  readonly unit: string;
  readonly labels: readonly string[];
  readonly series: ReadonlyArray<{ readonly name: string; readonly values: readonly number[] }>;
  /** Shown under the title (e.g. "Estimates for planning"). */
  readonly note: string;
  /** The takeaway, drawn as a callout under the plot. */
  readonly insight: string;
  /** Headline numbers above the plot. */
  readonly kpis: readonly Kpi[];
}

export const CHART_COLORS = ["#4f7cff", "#ff7a59", "#22c3a6", "#8b6cff", "#ffb547", "#ff5c8a", "#43d17a", "#38b6ff"] as const;

const MAX_POINTS = 12;
const MAX_SERIES = 4;

const clean = (v: unknown, max: number): string =>
  typeof v === "string"
    ? Array.from(v.replace(/\p{Cc}+/gu, " ").trim())
        .slice(0, max)
        .join("")
    : "";

/** Parse and validate a chart spec; undefined when it can't be drawn. */
export function parseChart(data: string | undefined): ChartSpec | undefined {
  if (!data) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const type = CHART_TYPES.includes(r.type as ChartType) ? (r.type as ChartType) : "bar";
  const labels = (Array.isArray(r.labels) ? r.labels : []).slice(0, MAX_POINTS).map((l) => clean(l, 24));
  const series = (Array.isArray(r.series) ? r.series : [])
    .slice(0, MAX_SERIES)
    .flatMap((s) => {
      if (typeof s !== "object" || s === null) return [];
      const o = s as Record<string, unknown>;
      const values = (Array.isArray(o.values) ? o.values : []).slice(0, labels.length || MAX_POINTS).map((v) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0));
      return values.length > 0 ? [{ name: clean(o.name, 30) || "Series", values }] : [];
    });
  if (series.length === 0) return undefined;
  const n = Math.max(...series.map((s) => s.values.length));
  const fullLabels = Array.from({ length: n }, (_, i) => labels[i] || `#${i + 1}`);
  // Short units ("$", "%", "k", "ms") go on every number; a long one ("Users Active (%)")
  // would clutter every label, so it becomes part of the note line instead.
  const unit = clean(r.unit, 40);
  const short = unit.length <= 5;
  const note = clean(r.note, 80);
  const kpis = (Array.isArray(r.kpis) ? r.kpis : []).slice(0, 4).flatMap((k): Kpi[] => {
    if (typeof k !== "object" || k === null) return [];
    const o = k as Record<string, unknown>;
    const value = clean(typeof o.value === "number" ? String(o.value) : o.value, 14);
    const label = clean(o.label, 32);
    return value && label ? [{ value, label, delta: clean(o.delta, 12) }] : [];
  });
  return {
    type,
    title: clean(r.title, 80),
    unit: short ? unit : "",
    labels: fullLabels,
    series,
    note: short || !unit ? note : [unit, note].filter(Boolean).join(" · ").slice(0, 90),
    insight: clean(r.insight, 220),
    kpis,
  };
}

export const fmt = (v: number, unit: string): string => {
  const abs = Math.abs(v);
  const s = abs >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : abs >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : abs >= 1e4 ? `${(v / 1e3).toFixed(0)}k` : abs >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : `${Math.round(v * 10) / 10}`;
  // "$" → "$248"; "$k" → "$248k"; "%" → "12%"; "users" → "12 users".
  if (/^[$€£₹]/.test(unit)) return `${unit.slice(0, 1)}${s}${unit.slice(1)}`;
  return unit ? `${s}${unit === "%" || /^[kKMB]$/.test(unit) ? "" : " "}${unit}` : s;
};

/** A "nice" axis maximum and tick step (1, 2, 2.5, 5 × 10ⁿ). */
function niceScale(max: number, ticks = 4): { max: number; step: number } {
  if (max <= 0) return { max: 1, step: 0.25 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  return { max: Math.ceil(max / step) * step, step };
}

export interface ChartTheme {
  readonly ink: string;
  readonly muted: string;
  readonly grid: string;
  readonly card: string;
  /** Tiles and callouts on the card. */
  readonly panel: string;
  readonly up: string;
  readonly down: string;
}

export const CHART_THEMES: Record<"light" | "dark", ChartTheme> = {
  light: { ink: "#14161c", muted: "#6c707a", grid: "#e6e2d8", card: "#fdfcf8", panel: "#f3f0e8", up: "#14915a", down: "#d6453d" },
  dark: { ink: "#eeece6", muted: "#9aa0ab", grid: "#2b2f38", card: "#171a21", panel: "#20242d", up: "#3ddc8b", down: "#ff6b61" },
};

let uid = 0;

interface Ctx {
  readonly spec: ChartSpec;
  readonly theme: ChartTheme;
  readonly s: number;
  readonly P: string;
  readonly out: string[];
  readonly defs: string[];
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const color = (i: number): string => CHART_COLORS[i % CHART_COLORS.length] ?? "#4f7cff";

/** Draw a chart as a standalone SVG of size w×h. Without a card it sits on someone else's background (slides). */
export function chartSvg(spec: ChartSpec, w: number, h: number, theme: ChartTheme, withCard = true): string {
  const P = `c${(uid++).toString(36)}`;
  const s = Math.max(0.75, Math.min(1.6, Math.min(w / 760, h / 500)));
  const pad = withCard ? Math.round(Math.max(18, Math.min(34, w * 0.036))) : 4;
  const out: string[] = [];
  const defs: string[] = [];
  const ctx: Ctx = { spec, theme, s, P, out, defs };
  const accent = color(0);
  if (withCard) {
    defs.push(`<linearGradient id="${P}bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${theme.card}"/><stop offset="1" stop-color="${mix(theme.card, accent, 0.05)}"/></linearGradient>`);
    defs.push(`<radialGradient id="${P}glow" cx="1" cy="0" r="0.9"><stop offset="0" stop-color="${accent}" stop-opacity="0.16"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>`);
    out.push(`<rect width="${w}" height="${h}" rx="${n1(20 * s)}" fill="url(#${P}bg)" stroke="${theme.grid}"/>`);
    out.push(`<rect width="${w}" height="${h}" rx="${n1(20 * s)}" fill="url(#${P}glow)"/>`);
  }
  let y = pad;
  const innerW = w - pad * 2;

  // Header: title (up to two lines), note, legend.
  if (spec.title) {
    const size = fitSize(spec.title, innerW, 24 * s, 13, 800, 2);
    const lines = wrapText(spec.title, innerW, size, 800, 2);
    out.push(textLines(lines, pad, y + size * 0.85, { size, fill: theme.ink, weight: 800, cls: "a-up", delay: 0 }));
    y += lines.length * size * 1.22 + 2;
  }
  if (spec.note) {
    const size = 12 * s;
    out.push(textLines(wrapText(spec.note, innerW, size, 500, 1), pad, y + size, { size, fill: theme.muted, weight: 500, cls: "a-up", delay: 60 }));
    y += size * 1.6;
  }
  const cartesian = spec.type === "bar" || spec.type === "stacked" || spec.type === "line" || spec.type === "area" || spec.type === "hbar" || spec.type === "radar";
  if (cartesian && spec.series.length > 1) {
    let lx = pad;
    const size = 12 * s;
    y += 6 * s;
    spec.series.forEach((ser, k) => {
      const tw = textWidth(ser.name, size, 600);
      if (lx + tw + 30 * s > w - pad) return;
      out.push(`<g ${anim("a-fade", 120 + k * 60)}><rect x="${n1(lx)}" y="${n1(y)}" width="${n1(tw + 30 * s)}" height="${n1(22 * s)}" rx="${n1(11 * s)}" fill="${theme.panel}"/><circle cx="${n1(lx + 11 * s)}" cy="${n1(y + 11 * s)}" r="${n1(4.5 * s)}" fill="${color(k)}"/>${textLines([ser.name], lx + 21 * s, y + 15.5 * s, { size, fill: theme.ink, weight: 600 })}</g>`);
      lx += tw + 38 * s;
    });
    y += 30 * s;
  }

  // KPI tiles.
  if (spec.kpis.length > 0 && h > 300) {
    y += 8 * s;
    const k = spec.kpis.length;
    const gap = 12 * s;
    const tw = (innerW - gap * (k - 1)) / k;
    const th = 66 * s;
    spec.kpis.forEach((kpi, i) => {
      const x = pad + i * (tw + gap);
      const tone = deltaTone(kpi.delta);
      const deltaColor = tone === "up" ? theme.up : tone === "down" ? theme.down : theme.muted;
      const vSize = fitSize(kpi.value, tw - 24 * s, 24 * s, 12, 800, 1);
      const parts = [
        `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(tw)}" height="${n1(th)}" rx="${n1(14 * s)}" fill="${theme.panel}"/>`,
        `<rect x="${n1(x)}" y="${n1(y + 14 * s)}" width="${n1(3 * s)}" height="${n1(th - 28 * s)}" rx="${n1(1.5 * s)}" fill="${color(i)}"/>`,
        textLines([kpi.value], x + 14 * s, y + 31 * s, { size: vSize, fill: theme.ink, weight: 800 }),
        textLines(wrapText(kpi.label, tw - 28 * s - (kpi.delta ? textWidth(kpi.delta, 11 * s, 700) + 10 * s : 0), 11 * s, 500, 1), x + 14 * s, y + 51 * s, { size: 11 * s, fill: theme.muted, weight: 500 }),
      ];
      if (kpi.delta) parts.push(textLines([kpi.delta], x + tw - 12 * s, y + 51 * s, { size: 11 * s, fill: deltaColor, weight: 700, anchor: "end" }));
      out.push(`<g ${anim("a-up", 160 + i * 90)}>${parts.join("")}</g>`);
    });
    y += th + 6 * s;
  }

  // Insight callout at the bottom.
  let bottom = h - pad;
  if (spec.insight && h > 260) {
    const size = 13 * s;
    const lines = wrapText(spec.insight, innerW - 52 * s, size, 500, 2);
    const ih = lines.length * size * 1.35 + 22 * s;
    bottom -= ih;
    const iy = bottom;
    out.push(
      `<g ${anim("a-up", 900)}><rect x="${pad}" y="${n1(iy)}" width="${n1(innerW)}" height="${n1(ih)}" rx="${n1(14 * s)}" fill="${mix(theme.panel, accent, 0.14)}"/><circle cx="${n1(pad + 22 * s)}" cy="${n1(iy + ih / 2)}" r="${n1(11 * s)}" fill="${accent}"/><path d="M${n1(pad + 23 * s)},${n1(iy + ih / 2 - 6 * s)} L${n1(pad + 18 * s)},${n1(iy + ih / 2 + 1 * s)} L${n1(pad + 22 * s)},${n1(iy + ih / 2 + 1 * s)} L${n1(pad + 21 * s)},${n1(iy + ih / 2 + 6 * s)} L${n1(pad + 26 * s)},${n1(iy + ih / 2 - 1 * s)} L${n1(pad + 22 * s)},${n1(iy + ih / 2 - 1 * s)} Z" fill="#fff"/>${textLines(lines, pad + 42 * s, iy + 11 * s + size, { size, fill: theme.ink, weight: 500, lineHeight: size * 1.35 })}</g>`,
    );
    bottom -= 10 * s;
  }

  const plot: Box = { x: pad, y: y + 10 * s, w: innerW, h: Math.max(40, bottom - y - 10 * s) };
  if (spec.type === "pie" || spec.type === "donut") drawPie(ctx, plot);
  else if (spec.type === "funnel") drawFunnel(ctx, plot);
  else if (spec.type === "radar") drawRadar(ctx, plot);
  else if (spec.type === "hbar") drawHBar(ctx, plot);
  else drawCartesian(ctx, plot);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}"><defs>${defs.join("")}</defs>${out.join("")}</svg>`;
}

function pill(ctx: Ctx, cx: number, y: number, text: string, fill: string, delay: number): string {
  const size = 11.5 * ctx.s;
  const tw = textWidth(text, size, 700) + 14 * ctx.s;
  const hh = 21 * ctx.s;
  return `<g ${anim("a-pop", delay)}><rect x="${n1(cx - tw / 2)}" y="${n1(y - hh)}" width="${n1(tw)}" height="${n1(hh)}" rx="${n1(hh / 2)}" fill="${fill}"/>${textLines([text], cx, y - hh / 2 + size * 0.36, { size, fill: "#ffffff", weight: 700, anchor: "middle" })}</g>`;
}

function drawCartesian(ctx: Ctx, plot: Box): void {
  const { spec, theme, s, P, out, defs } = ctx;
  const n = spec.labels.length;
  const stacked = spec.type === "stacked";
  const sums = spec.labels.map((_, i) => spec.series.reduce((a, ser) => a + Math.max(0, ser.values[i] ?? 0), 0));
  const all = stacked ? sums : spec.series.flatMap((ser) => ser.values);
  const { max, step } = niceScale(Math.max(0, ...all));
  const tickSize = 11 * s;
  let axisW = 0;
  for (let v = 0; v <= max + 1e-9; v += step) axisW = Math.max(axisW, textWidth(fmt(v, spec.unit), tickSize, 500));
  axisW += 10 * s;
  const labelH = 22 * s;
  const px = plot.x + axisW;
  const pw = plot.w - axisW;
  const top = plot.y + 18 * s;
  const ph = plot.y + plot.h - labelH - top;
  const base = top + ph;
  const yOf = (v: number): number => base - (Math.max(0, v) / max) * ph;
  for (let v = 0; v <= max + 1e-9; v += step) {
    const yy = yOf(v);
    out.push(`<line x1="${n1(px)}" x2="${n1(px + pw)}" y1="${n1(yy)}" y2="${n1(yy)}" stroke="${theme.grid}" stroke-width="${v === 0 ? 1.4 : 1}" ${v === 0 ? "" : `stroke-dasharray="2 5"`}/>`);
    out.push(textLines([fmt(v, spec.unit)], px - 10 * s, yy + 4 * s, { size: tickSize, fill: theme.muted, weight: 500, anchor: "end" }));
  }
  const slot = pw / Math.max(1, n);
  const maxChars = Math.max(3, Math.floor(slot / (6.2 * s)));
  spec.labels.forEach((label, i) => {
    out.push(textLines([label.length > maxChars ? `${label.slice(0, maxChars - 1)}…` : label], px + slot * (i + 0.5), base + 17 * s, { size: tickSize, fill: theme.muted, weight: 500, anchor: "middle" }));
  });
  spec.series.forEach((_, k) => {
    const c = color(k);
    defs.push(`<linearGradient id="${P}g${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${mix(c, theme.card, 0.35)}"/></linearGradient>`);
    defs.push(`<linearGradient id="${P}a${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity="0.38"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient>`);
  });

  if (spec.type === "bar" || stacked) {
    const groups = stacked ? 1 : spec.series.length;
    const bw = Math.min(58 * s, (slot * 0.64) / groups);
    const r = Math.min(8 * s, bw / 3);
    const single = spec.series.length === 1;
    const values = spec.series[0]?.values ?? [];
    const best = single ? values.indexOf(Math.max(...values)) : -1;
    spec.labels.forEach((_, i) => {
      let acc = 0;
      spec.series.forEach((ser, k) => {
        const v = Math.max(0, ser.values[i] ?? 0);
        const x = px + slot * (i + 0.5) - (bw * groups) / 2 + (stacked ? 0 : k * bw) + 1.5;
        const bwi = bw - 3;
        const y0 = stacked ? yOf(acc) : base;
        const y1 = stacked ? yOf(acc + v) : yOf(v);
        acc += v;
        const hh = Math.max(1, y0 - y1);
        const isTop = !stacked || k === spec.series.length - 1;
        const rr = Math.min(r, hh);
        const d = isTop
          ? `M${n1(x)},${n1(y0)} V${n1(y1 + rr)} Q${n1(x)},${n1(y1)} ${n1(x + rr)},${n1(y1)} H${n1(x + bwi - rr)} Q${n1(x + bwi)},${n1(y1)} ${n1(x + bwi)},${n1(y1 + rr)} V${n1(y0)} Z`
          : `M${n1(x)},${n1(y0)} V${n1(y1)} H${n1(x + bwi)} V${n1(y0)} Z`;
        const dim = single && i !== best ? ` fill-opacity="0.72"` : "";
        out.push(`<path d="${d}" fill="url(#${P}g${k})"${dim} ${anim("a-grow", 200 + i * 70 + k * 40)}/>`);
        if (single && n <= 12) {
          const label = fmt(v, spec.unit);
          if (i === best) out.push(pill(ctx, x + bwi / 2, y1 - 7 * s, label, color(0), 700 + i * 70));
          else out.push(textLines([label], x + bwi / 2, y1 - 8 * s, { size: 11 * s, fill: theme.muted, weight: 700, anchor: "middle", cls: "a-fade", delay: 700 + i * 70 }));
        }
      });
      if (stacked && n <= 12) out.push(textLines([fmt(sums[i] ?? 0, spec.unit)], px + slot * (i + 0.5), yOf(sums[i] ?? 0) - 8 * s, { size: 11 * s, fill: theme.ink, weight: 700, anchor: "middle", cls: "a-fade", delay: 800 + i * 70 }));
    });
    return;
  }

  // Line / area: smooth curves, a soft glow, and the last value called out.
  spec.series.forEach((ser, k) => {
    const c = color(k);
    const pts = ser.values.map((v, i) => [px + slot * (i + 0.5), yOf(v)] as const);
    const d = smoothPath(pts, top - 8 * s, base);
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (!first || !last) return;
    if (spec.type === "area") out.push(`<path d="${d} L${n1(last[0])},${n1(base)} L${n1(first[0])},${n1(base)} Z" fill="url(#${P}a${k})" ${anim("a-fade", 700 + k * 150)}/>`);
    out.push(`<path d="${d}" fill="none" stroke="${c}" stroke-opacity="0.18" stroke-width="${n1(10 * s)}" stroke-linecap="round" pathLength="1" ${anim("a-draw", 200 + k * 150)}/>`);
    out.push(`<path d="${d}" fill="none" stroke="${c}" stroke-width="${n1(3.2 * s)}" stroke-linejoin="round" stroke-linecap="round" pathLength="1" ${anim("a-draw", 200 + k * 150)}/>`);
    pts.forEach(([x, yy], i) => {
      const end = i === pts.length - 1;
      out.push(`<circle cx="${n1(x)}" cy="${n1(yy)}" r="${n1((end ? 6 : 3.6) * s)}" fill="${end ? c : theme.card}" stroke="${end ? theme.card : c}" stroke-width="${n1(2.4 * s)}" ${anim("a-pop", 300 + i * 90 + k * 150)}/>`);
    });
    if (spec.series.length <= 2) out.push(pill(ctx, last[0], last[1] - 12 * s, fmt(ser.values[ser.values.length - 1] ?? 0, spec.unit), c, 1300 + k * 150));
  });
}

function drawHBar(ctx: Ctx, plot: Box): void {
  const { spec, theme, s, P, out, defs } = ctx;
  const ser = spec.series[0];
  if (!ser) return;
  const values = ser.values;
  const max = Math.max(1, ...values);
  const best = values.indexOf(Math.max(...values));
  const size = 12.5 * s;
  const labelW = Math.min(plot.w * 0.34, Math.max(...spec.labels.map((l) => textWidth(l, size, 600))) + 14 * s);
  const valueW = Math.max(...values.map((v) => textWidth(fmt(v, spec.unit), size, 700))) + 14 * s;
  const rowH = plot.h / Math.max(1, values.length);
  const bh = Math.min(30 * s, rowH * 0.62);
  const c = color(0);
  defs.push(`<linearGradient id="${P}h" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${mix(c, theme.card, 0.3)}"/><stop offset="1" stop-color="${c}"/></linearGradient>`);
  values.forEach((v, i) => {
    const y = plot.y + i * rowH + (rowH - bh) / 2;
    const x = plot.x + labelW;
    const bw = Math.max(bh, (Math.max(0, v) / max) * (plot.w - labelW - valueW));
    out.push(textLines(wrapText(spec.labels[i] ?? "", labelW - 12 * s, size, 600, 1), plot.x + labelW - 12 * s, y + bh / 2 + size * 0.36, { size, fill: theme.ink, weight: 600, anchor: "end" }));
    out.push(`<rect x="${n1(x)}" y="${n1(y)}" width="${n1(plot.w - labelW - valueW)}" height="${n1(bh)}" rx="${n1(bh / 2)}" fill="${theme.panel}"/>`);
    out.push(`<rect x="${n1(x)}" y="${n1(y)}" width="${n1(bw)}" height="${n1(bh)}" rx="${n1(bh / 2)}" fill="${i === best ? color(1) : `url(#${P}h)`}" ${anim("a-growx", 200 + i * 80)}/>`);
    out.push(textLines([fmt(v, spec.unit)], x + bw + 10 * s, y + bh / 2 + size * 0.36, { size, fill: i === best ? theme.ink : theme.muted, weight: 700, cls: "a-fade", delay: 600 + i * 80 }));
  });
}

function drawPie(ctx: Ctx, plot: Box): void {
  const { spec, theme, s, out } = ctx;
  const values = (spec.series[0]?.values ?? []).map((v) => Math.max(0, v));
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const r = Math.max(20, Math.min(plot.h / 2 - 4, plot.w * 0.27));
  const cx = plot.x + r + 8 * s;
  const cy = plot.y + plot.h / 2;
  const donut = spec.type === "donut";
  const inner = donut ? r * 0.62 : 0;
  const gap = values.length > 1 ? 0.018 : 0;
  let a0 = -Math.PI / 2;
  const biggest = values.indexOf(Math.max(...values));
  values.forEach((v, i) => {
    const a1 = a0 + (v / total) * Math.PI * 2;
    if (a1 - a0 > gap * 2) {
      const grow = i === biggest && !donut ? 6 * s : 0;
      const mid = (a0 + a1) / 2;
      const ox = Math.cos(mid) * grow;
      const oy = Math.sin(mid) * grow;
      const path = values.length === 1 ? (donut ? arcPath(cx, cy, r, inner, 0, Math.PI * 1.9999) : `M${n1(cx - r)},${n1(cy)} a${n1(r)},${n1(r)} 0 1 0 ${n1(r * 2)},0 a${n1(r)},${n1(r)} 0 1 0 ${n1(-r * 2)},0`) : arcPath(cx + ox, cy + oy, r, inner, a0 + gap, a1 - gap);
      out.push(`<path d="${path}" fill="${color(i)}" ${donut ? "" : `stroke="${theme.card}" stroke-width="2"`} ${anim("a-spin", 150 + i * 90)}/>`);
      // Percent inside big slices.
      const pct = Math.round((v / total) * 100);
      if (pct >= 8) {
        const lr = donut ? (r + inner) / 2 : r * 0.62;
        out.push(textLines([`${pct}%`], cx + ox + Math.cos(mid) * lr, cy + oy + Math.sin(mid) * lr + 4 * s, { size: 12 * s, fill: "#ffffff", weight: 800, anchor: "middle", cls: "a-fade", delay: 800 + i * 60 }));
      }
    }
    a0 = a1;
  });
  if (donut) {
    // Shares of 100%: the total says nothing, so the center names the leader instead.
    const shares = spec.unit === "%" && Math.abs(total - 100) < 3;
    const top = values[biggest] ?? 0;
    const value = shares ? `${Math.round(top)}%` : fmt(total, spec.unit);
    const caption = shares ? (spec.labels[biggest] ?? "") : "total";
    const big = fitSize(value, inner * 1.5, Math.max(14, r * 0.34), 10, 800, 1);
    out.push(textLines([value], cx, cy + big * 0.3, { size: big, fill: theme.ink, weight: 800, anchor: "middle", cls: "a-pop", delay: 700 }));
    out.push(textLines(wrapText(caption, inner * 1.5, 12 * s, 600, 1), cx, cy + big * 0.3 + 18 * s, { size: 12 * s, fill: theme.muted, weight: 600, anchor: "middle", cls: "a-fade", delay: 800 }));
  }
  // Legend: name, value, share bar.
  const lx = cx + r + 30 * s;
  const lw = plot.x + plot.w - lx;
  const rowH = Math.min(40 * s, plot.h / Math.max(1, values.length));
  const startY = cy - (rowH * values.length) / 2;
  values.forEach((v, i) => {
    const y = startY + i * rowH;
    const pct = v / total;
    const size = Math.min(13 * s, rowH * 0.36);
    out.push(
      `<g ${anim("a-left", 300 + i * 80)}><circle cx="${n1(lx + 5 * s)}" cy="${n1(y + size * 0.6)}" r="${n1(5 * s)}" fill="${color(i)}"/>${textLines(wrapText(spec.labels[i] ?? "", lw - 90 * s, size, 600, 1), lx + 16 * s, y + size, { size, fill: theme.ink, weight: 600 })}${textLines([spec.unit === "%" ? fmt(v, "%") : `${fmt(v, spec.unit)} · ${Math.round(pct * 100)}%`], lx + lw, y + size, { size: size * 0.92, fill: theme.muted, weight: 700, anchor: "end" })}<rect x="${n1(lx + 16 * s)}" y="${n1(y + size + 6 * s)}" width="${n1(lw - 16 * s)}" height="${n1(4 * s)}" rx="${n1(2 * s)}" fill="${theme.panel}"/><rect x="${n1(lx + 16 * s)}" y="${n1(y + size + 6 * s)}" width="${n1(Math.max(4 * s, (lw - 16 * s) * pct))}" height="${n1(4 * s)}" rx="${n1(2 * s)}" fill="${color(i)}"/></g>`,
    );
  });
}

function drawFunnel(ctx: Ctx, plot: Box): void {
  const { spec, theme, s, P, out, defs } = ctx;
  const values = (spec.series[0]?.values ?? []).map((v) => Math.max(0, v));
  const max = Math.max(1, ...values);
  const areaW = plot.w * 0.6;
  const rowH = plot.h / Math.max(1, values.length);
  const cx = plot.x + areaW / 2;
  const widthOf = (v: number): number => Math.max(0.16, v / max) * areaW;
  values.forEach((v, i) => {
    const c = color(i);
    defs.push(`<linearGradient id="${P}f${i}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${mix(c, "#ffffff", 0.18)}"/></linearGradient>`);
    const y = plot.y + i * rowH;
    const w0 = widthOf(v);
    const w1 = i < values.length - 1 ? widthOf(values[i + 1] ?? v) : w0 * 0.82;
    const g = 3 * s;
    out.push(`<path d="M${n1(cx - w0 / 2)},${n1(y + g)} L${n1(cx + w0 / 2)},${n1(y + g)} L${n1(cx + w1 / 2)},${n1(y + rowH - g)} L${n1(cx - w1 / 2)},${n1(y + rowH - g)} Z" fill="url(#${P}f${i})" ${anim("a-growx-c", 150 + i * 110)}/>`);
    const size = Math.min(17 * s, rowH * 0.4);
    out.push(textLines([fmt(v, spec.unit)], cx, y + rowH / 2 + size * 0.36, { size, fill: "#ffffff", weight: 800, anchor: "middle", cls: "a-fade", delay: 500 + i * 110 }));
    const lx = plot.x + areaW + 22 * s;
    const lsize = Math.min(13.5 * s, rowH * 0.34);
    out.push(textLines(wrapText(spec.labels[i] ?? "", plot.x + plot.w - lx, lsize, 700, 1), lx, y + rowH / 2 - (i > 0 ? 2 * s : -lsize * 0.36), { size: lsize, fill: theme.ink, weight: 700, cls: "a-left", delay: 400 + i * 110 }));
    if (i > 0) {
      const prev = values[i - 1] ?? 0;
      const conv = prev > 0 ? Math.round((v / prev) * 100) : 0;
      const ofTotal = values[0] ? Math.round((v / (values[0] ?? 1)) * 100) : 0;
      out.push(textLines([`↓ ${conv}% from previous · ${ofTotal}% of start`], lx, y + rowH / 2 + lsize * 1.25, { size: lsize * 0.8, fill: conv >= 50 ? theme.up : theme.down, weight: 600, cls: "a-left", delay: 500 + i * 110 }));
    }
  });
}

function drawRadar(ctx: Ctx, plot: Box): void {
  const { spec, theme, s, out } = ctx;
  const n = spec.labels.length;
  if (n < 3) {
    drawCartesian(ctx, plot);
    return;
  }
  const r = Math.max(30, Math.min(plot.w / 2 - 90 * s, plot.h / 2 - 22 * s));
  const cx = plot.x + plot.w / 2;
  const cy = plot.y + plot.h / 2;
  const max = niceScale(Math.max(1, ...spec.series.flatMap((x) => x.values))).max;
  const at = (i: number, rr: number): [number, number] => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
  };
  for (let ring = 1; ring <= 4; ring += 1) {
    const pts = Array.from({ length: n }, (_, i) => at(i, (r * ring) / 4).map(n1).join(",")).join(" ");
    out.push(`<polygon points="${pts}" fill="${ring % 2 ? theme.panel : "none"}" fill-opacity="0.6" stroke="${theme.grid}"/>`);
  }
  spec.labels.forEach((label, i) => {
    const [x, y] = at(i, r);
    out.push(`<line x1="${n1(cx)}" y1="${n1(cy)}" x2="${n1(x)}" y2="${n1(y)}" stroke="${theme.grid}"/>`);
    const [lx, ly] = at(i, r + 16 * s);
    const anchor = Math.abs(lx - cx) < 8 ? "middle" : lx > cx ? "start" : "end";
    out.push(textLines(wrapText(label, 110 * s, 12 * s, 600, 1), lx, ly + 4 * s, { size: 12 * s, fill: theme.ink, weight: 600, anchor }));
  });
  spec.series.forEach((ser, k) => {
    const c = color(k);
    const pts = ser.values.map((v, i) => at(i, (Math.max(0, v) / max) * r));
    out.push(`<polygon points="${pts.map((p) => p.map(n1).join(",")).join(" ")}" fill="${c}" fill-opacity="0.22" stroke="${c}" stroke-width="${n1(2.4 * s)}" stroke-linejoin="round" class="a-scale" style="--d:${250 + k * 200}ms;transform-origin:${n1(cx)}px ${n1(cy)}px"/>`);
    pts.forEach(([x, y], i) => out.push(`<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(3.6 * s)}" fill="${c}" ${anim("a-pop", 600 + i * 60 + k * 200)}/>`));
  });
}

/** The placeholder card a 3D scene shows on the 2D canvas (the live 3D view sits on top). */
export function sceneCardSvg(title: string, w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><radialGradient id="bg" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="#1d2440"/><stop offset="1" stop-color="#07080d"/></radialGradient></defs><rect width="${w}" height="${h}" rx="18" fill="url(#bg)"/><text x="20" y="34" font-family="${FONT}" font-size="15" font-weight="800" fill="#eceae4">${esc(title || "3D scene")}</text><text x="20" y="${h - 18}" font-family="${FONT}" font-size="11" fill="#9a9ea6">3D · double-click to orbit</text></svg>`;
}
