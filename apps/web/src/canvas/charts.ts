/**
 * Charts on the canvas. A chart shape stores a small JSON spec; this module validates it
 * (it may come from the AI or another user, so it's untrusted) and draws it as SVG. The
 * renderer rasterizes that SVG into a texture, and export embeds the same SVG, so what you
 * see and what you export are identical.
 */
export type ChartType = "bar" | "line" | "area" | "pie" | "donut" | "funnel";
export const CHART_TYPES: readonly ChartType[] = ["bar", "line", "area", "pie", "donut", "funnel"];

export interface ChartSpec {
  readonly type: ChartType;
  readonly title: string;
  readonly unit: string;
  readonly labels: readonly string[];
  readonly series: ReadonlyArray<{ readonly name: string; readonly values: readonly number[] }>;
  /** Shown under the title (e.g. "Estimates for planning"). */
  readonly note: string;
}

export const CHART_COLORS = ["#2f63ff", "#ff8a5b", "#19c3a5", "#7b6cff", "#ffb020", "#ff4f8b", "#52d36b", "#2f9bff"] as const;

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
  return { type, title: clean(r.title, 80), unit: short ? unit : "", labels: fullLabels, series, note: short || !unit ? note : [unit, note].filter(Boolean).join(" · ").slice(0, 90) };
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (v: number, unit: string): string => {
  const abs = Math.abs(v);
  const s = abs >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : abs >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : abs >= 1e4 ? `${(v / 1e3).toFixed(0)}k` : abs >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : `${Math.round(v * 10) / 10}`;
  return unit === "$" || unit === "€" || unit === "£" || unit === "₹" ? `${unit}${s}` : unit ? `${s}${unit === "%" ? "" : " "}${unit}` : s;
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
}

export const CHART_THEMES: Record<"light" | "dark", ChartTheme> = {
  light: { ink: "#111318", muted: "#6c6f76", grid: "#e4e0d6", card: "#fbfaf6" },
  dark: { ink: "#eceae4", muted: "#9a9ea6", grid: "#2c3038", card: "#1b1e24" },
};

const FONT = "Inter, Helvetica Neue, Arial, sans-serif";

/** Draw a chart as a standalone SVG of size w×h (the card, title, plot and legend). */
export function chartSvg(spec: ChartSpec, w: number, h: number, theme: ChartTheme, withCard = true): string {
  const pad = 22;
  const titleH = spec.title ? 30 : 0;
  const noteH = spec.note ? 18 : 0;
  const legendH = spec.series.length > 1 || spec.type === "pie" || spec.type === "donut" ? 26 : 0;
  const top = pad + titleH + noteH + 6;
  const body: string[] = [];
  const defs: string[] = [];
  if (withCard) body.push(`<rect x="0" y="0" width="${w}" height="${h}" rx="18" fill="${theme.card}" stroke="${theme.grid}"/>`);
  if (spec.title) body.push(`<text x="${pad}" y="${pad + 18}" font-family="${FONT}" font-size="18" font-weight="800" fill="${theme.ink}">${esc(spec.title)}</text>`);
  if (spec.note) body.push(`<text x="${pad}" y="${pad + titleH + 12}" font-family="${FONT}" font-size="11.5" fill="${theme.muted}">${esc(spec.note)}</text>`);
  const plot = { x: pad, y: top, w: w - pad * 2, h: h - top - pad - legendH };
  const color = (i: number): string => CHART_COLORS[i % CHART_COLORS.length] ?? "#2f63ff";

  if (spec.type === "pie" || spec.type === "donut") {
    const values = spec.series[0]?.values ?? [];
    const total = values.reduce((a, b) => a + Math.max(0, b), 0) || 1;
    const r = Math.max(10, Math.min(plot.w * 0.42, plot.h / 2) - 4);
    const cx = plot.x + Math.min(plot.w * 0.32, r + 8);
    const cy = plot.y + plot.h / 2;
    let a0 = -Math.PI / 2;
    values.forEach((v, i) => {
      const a1 = a0 + (Math.max(0, v) / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a: number, rr: number) => `${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`;
      if (values.length === 1) body.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color(i)}"/>`);
      else body.push(`<path d="M${cx},${cy} L${p(a0, r)} A${r},${r} 0 ${large} 1 ${p(a1, r)} Z" fill="${color(i)}" stroke="${theme.card}" stroke-width="2"/>`);
      a0 = a1;
    });
    if (spec.type === "donut") {
      body.push(`<circle cx="${cx}" cy="${cy}" r="${r * 0.58}" fill="${theme.card}"/>`);
      body.push(`<text x="${cx}" y="${cy + 2}" text-anchor="middle" font-family="${FONT}" font-size="${Math.max(12, r * 0.3)}" font-weight="800" fill="${theme.ink}">${esc(fmt(total, spec.unit))}</text>`);
      body.push(`<text x="${cx}" y="${cy + Math.max(12, r * 0.3) * 0.75}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${theme.muted}">total</text>`);
    }
    // Legend with percentages, to the right.
    const lx = cx + r + 26;
    spec.labels.slice(0, values.length).forEach((label, i) => {
      const y = plot.y + 8 + i * 22;
      if (y > plot.y + plot.h + legendH) return;
      const pct = Math.round(((values[i] ?? 0) / total) * 100);
      body.push(`<rect x="${lx}" y="${y - 9}" width="11" height="11" rx="3" fill="${color(i)}"/>`);
      body.push(`<text x="${lx + 18}" y="${y}" font-family="${FONT}" font-size="12.5" fill="${theme.ink}">${esc(label)}</text>`);
      body.push(`<text x="${w - pad}" y="${y}" text-anchor="end" font-family="${FONT}" font-size="12.5" font-weight="700" fill="${theme.muted}">${pct}%</text>`);
    });
  } else if (spec.type === "funnel") {
    const values = spec.series[0]?.values ?? [];
    const max = Math.max(1, ...values);
    const rowH = plot.h / Math.max(1, values.length);
    values.forEach((v, i) => {
      const bw = Math.max(24, (v / max) * plot.w * 0.72);
      const x = plot.x + (plot.w * 0.72 - bw) / 2;
      const y = plot.y + i * rowH + 3;
      body.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${(rowH - 6).toFixed(1)}" rx="8" fill="${color(i)}"/>`);
      const conv = i > 0 && (values[i - 1] ?? 0) > 0 ? ` · ${Math.round((v / (values[i - 1] ?? 1)) * 100)}%` : "";
      body.push(`<text x="${plot.x + plot.w * 0.74}" y="${(y + rowH / 2).toFixed(1)}" font-family="${FONT}" font-size="12" fill="${theme.ink}"><tspan font-weight="700">${esc(fmt(v, spec.unit))}</tspan><tspan fill="${theme.muted}"> ${esc(spec.labels[i] ?? "")}${conv}</tspan></text>`);
    });
  } else {
    const all = spec.series.flatMap((s) => s.values);
    const { max, step } = niceScale(Math.max(0, ...all));
    const axisW = 44;
    const labelH = 22;
    const px = plot.x + axisW;
    const pw = plot.w - axisW;
    const ph = plot.h - labelH;
    for (let v = 0; v <= max + 1e-9; v += step) {
      const y = plot.y + ph - (v / max) * ph;
      body.push(`<line x1="${px}" x2="${px + pw}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${theme.grid}" stroke-dasharray="${v === 0 ? "" : "3 4"}"/>`);
      body.push(`<text x="${px - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-family="${FONT}" font-size="11" fill="${theme.muted}">${esc(fmt(v, spec.unit))}</text>`);
    }
    const n = spec.labels.length;
    const slot = pw / Math.max(1, n);
    spec.labels.forEach((label, i) => {
      body.push(`<text x="${(px + slot * (i + 0.5)).toFixed(1)}" y="${plot.y + ph + 16}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${theme.muted}">${esc(label.length > 10 && n > 6 ? `${label.slice(0, 9)}…` : label)}</text>`);
    });
    const y = (v: number): number => plot.y + ph - (Math.max(0, v) / max) * ph;
    if (spec.type === "bar") {
      const groups = spec.series.length;
      const bw = Math.min(46, (slot * 0.72) / groups);
      spec.series.forEach((s, k) => {
        s.values.forEach((v, i) => {
          const x = px + slot * (i + 0.5) - (bw * groups) / 2 + k * bw;
          const top = y(v);
          const height = Math.max(1, plot.y + ph - top);
          defs.push(`<linearGradient id="g${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color(k)}"/><stop offset="1" stop-color="${color(k)}" stop-opacity="0.65"/></linearGradient>`);
          body.push(`<rect x="${(x + 1).toFixed(1)}" y="${top.toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${height.toFixed(1)}" rx="${Math.min(6, bw / 3).toFixed(1)}" fill="url(#g${k})"/>`);
          if (groups === 1 && n <= 8) body.push(`<text x="${(x + bw / 2).toFixed(1)}" y="${(top - 6).toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="700" fill="${theme.ink}">${esc(fmt(v, spec.unit))}</text>`);
        });
      });
    } else {
      spec.series.forEach((s, k) => {
        const pts = s.values.map((v, i) => [px + slot * (i + 0.5), y(v)] as const);
        const d = pts.map(([x, yy], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${yy.toFixed(1)}`).join(" ");
        if (spec.type === "area" && pts.length > 0) {
          defs.push(`<linearGradient id="a${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color(k)}" stop-opacity="0.45"/><stop offset="1" stop-color="${color(k)}" stop-opacity="0.02"/></linearGradient>`);
          const last = pts[pts.length - 1];
          const first = pts[0];
          if (last && first) body.push(`<path d="${d} L${last[0].toFixed(1)},${plot.y + ph} L${first[0].toFixed(1)},${plot.y + ph} Z" fill="url(#a${k})"/>`);
        }
        body.push(`<path d="${d}" fill="none" stroke="${color(k)}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`);
        pts.forEach(([x, yy]) => body.push(`<circle cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" r="3.8" fill="${theme.card}" stroke="${color(k)}" stroke-width="2.4"/>`));
      });
    }
    if (spec.series.length > 1) {
      let lx = plot.x;
      spec.series.forEach((s, k) => {
        const ly = h - pad - 4;
        body.push(`<rect x="${lx}" y="${ly - 9}" width="11" height="11" rx="3" fill="${color(k)}"/>`);
        body.push(`<text x="${lx + 17}" y="${ly}" font-family="${FONT}" font-size="12" fill="${theme.ink}">${esc(s.name)}</text>`);
        lx += 30 + s.name.length * 7;
      });
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs.join("")}</defs>${body.join("")}</svg>`;
}

/** The placeholder card a 3D scene shows on the 2D canvas (the live 3D view sits on top). */
export function sceneCardSvg(title: string, w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><radialGradient id="bg" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="#1d2440"/><stop offset="1" stop-color="#07080d"/></radialGradient></defs><rect width="${w}" height="${h}" rx="18" fill="url(#bg)"/><text x="20" y="34" font-family="${FONT}" font-size="15" font-weight="800" fill="#eceae4">${esc(title || "3D scene")}</text><text x="20" y="${h - 18}" font-family="${FONT}" font-size="11" fill="#9a9ea6">3D · drag to orbit</text></svg>`;
}
