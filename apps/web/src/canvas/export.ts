import type { ShapeView } from "@canvas/doc";
import { FRAME_TITLE_H, arrowEnds, boundsOf, center, pathPoints, visualBounds, type Lookup, type Rect } from "./geometry";
import { CHART_THEMES, chartSvg, parseChart, sceneCardSvg } from "./charts";
import { displayFill, hex, inkColor, labelColor, type CanvasTheme } from "./theme";

/**
 * Export the board as SVG (vector, from the document itself, not a screenshot), and PNG by
 * rasterizing that SVG. The same code draws the dashboard thumbnails (without text).
 */
export interface SvgOptions {
  readonly theme: CanvasTheme;
  readonly padding?: number;
  /** Draw labels (off for thumbnails). */
  readonly text?: boolean;
  readonly background?: boolean;
  readonly maxShapes?: number;
}

const FONT = "Inter, Helvetica Neue, Arial, sans-serif";
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v: number): string => (Math.round(v * 10) / 10).toString();

let measureCtx: CanvasRenderingContext2D | null | undefined;
function measure(text: string, font: string): number {
  if (measureCtx === undefined) measureCtx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * 8;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

/** Greedy word wrap, matching the canvas closely enough for export. */
export function wrap(text: string, width: number, font: string): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (!word) continue;
      const next = line ? `${line} ${word}` : word;
      if (measure(next, font) <= width || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

function textBlock(lines: readonly string[], x: number, y: number, size: number, lineHeight: number, color: number, weight: number, anchor: "start" | "middle" = "start"): string {
  return `<text x="${n(x)}" y="${n(y)}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${hex(color)}" text-anchor="${anchor}">${lines
    .map((line, i) => `<tspan x="${n(x)}" dy="${i === 0 ? size : lineHeight}">${esc(line)}</tspan>`)
    .join("")}</text>`;
}

function shapeSvg(s: ShapeView, lookup: Lookup, theme: CanvasTheme, withText: boolean): string {
  const fill = hex(displayFill(s.fill, theme));
  const c = center(s);
  const rot = s.rotation ? ` transform="rotate(${n((s.rotation * 180) / Math.PI)} ${n(c.x)} ${n(c.y)})"` : "";
  const label = withText ? s.label : undefined;
  const textColor = labelColor(displayFill(s.fill, theme));
  switch (s.kind) {
    case "rect": {
      const body = `<rect x="${n(s.x)}" y="${n(s.y)}" width="${n(s.w)}" height="${n(s.h)}" rx="${Math.min(9, s.w / 4, s.h / 4)}" fill="${fill}"/>`;
      const text = label ? textBlock(wrap(label, s.w - 22, `600 15px ${FONT}`), s.x + 11, s.y + 8, 15, 19, textColor, 600) : "";
      return `<g${rot}>${body}${text}</g>`;
    }
    case "ellipse":
    case "diamond": {
      const body =
        s.kind === "ellipse"
          ? `<ellipse cx="${n(c.x)}" cy="${n(c.y)}" rx="${n(s.w / 2)}" ry="${n(s.h / 2)}" fill="${fill}"/>`
          : `<polygon points="${n(c.x)},${n(s.y)} ${n(s.x + s.w)},${n(c.y)} ${n(c.x)},${n(s.y + s.h)} ${n(s.x)},${n(c.y)}" fill="${fill}"/>`;
      let text = "";
      if (label) {
        const lines = wrap(label, s.w * (s.kind === "diamond" ? 0.6 : 0.72) - 8, `600 15px ${FONT}`);
        text = textBlock(lines, c.x, c.y - (lines.length * 19) / 2 - 3, 15, 19, textColor, 600, "middle");
      }
      return `<g${rot}>${body}${text}</g>`;
    }
    case "frame": {
      const body = `<rect x="${n(s.x)}" y="${n(s.y)}" width="${n(s.w)}" height="${n(s.h)}" rx="14" fill="${fill}" fill-opacity="0.12" stroke="${fill}" stroke-opacity="0.55" stroke-width="1.5"/>`;
      const title = withText ? textBlock([s.label ?? "Frame"], s.x + 2, s.y - FRAME_TITLE_H + 4, 14, 18, theme.muted, 700) : "";
      return `<g${rot}>${body}${title}</g>`;
    }
    case "text":
      return label ? `<g${rot}>${textBlock(wrap(label, s.w - 4, `700 24px ${FONT}`), s.x + 2, s.y, 24, 30, theme.ink, 700)}</g>` : "";
    case "path": {
      const pts = pathPoints(s);
      return `<polyline points="${pts.map((p) => `${n(p.x)},${n(p.y)}`).join(" ")}" fill="none" stroke="${hex(inkColor(s.fill, theme))}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    case "arrow": {
      const { a, b } = arrowEnds(s, lookup);
      const color = hex(inkColor(s.fill, theme));
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const head = 13;
      const tail = { x: b.x - Math.cos(angle) * head * 0.8, y: b.y - Math.sin(angle) * head * 0.8 };
      const p1 = { x: b.x - Math.cos(angle - 0.42) * head, y: b.y - Math.sin(angle - 0.42) * head };
      const p2 = { x: b.x - Math.cos(angle + 0.42) * head, y: b.y - Math.sin(angle + 0.42) * head };
      let text = "";
      if (label) {
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const w = measure(label, `600 13px ${FONT}`) + 16;
        text = `<rect x="${n(mid.x - w / 2)}" y="${n(mid.y - 12)}" width="${n(w)}" height="24" rx="10" fill="${hex(theme.paper)}" stroke="${hex(theme.line)}"/>${textBlock([label], mid.x, mid.y - 9, 13, 16, theme.ink, 600, "middle")}`;
      }
      return `<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(tail.x)}" y2="${n(tail.y)}" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/><polygon points="${n(b.x)},${n(b.y)} ${n(p1.x)},${n(p1.y)} ${n(p2.x)},${n(p2.y)}" fill="${color}"/>${text}`;
    }
    case "chart":
    case "scene3d": {
      const spec = s.kind === "chart" ? parseChart(s.data) : undefined;
      const w = Math.max(40, Math.round(s.w));
      const h = Math.max(30, Math.round(s.h));
      const inner = spec ? chartSvg(spec, w, h, CHART_THEMES[theme.name]) : sceneCardSvg(s.label ?? "3D scene", w, h);
      // Nest the chart's own SVG, positioned and sized like the shape.
      return `<g${rot}>${inner.replace("<svg ", `<svg x="${n(s.x)}" y="${n(s.y)}" `)}</g>`;
    }
    case "comment": {
      const pin = `<circle cx="${n(s.x + 16)}" cy="${n(s.y + 16)}" r="15" fill="${fill}" stroke="#fff" stroke-width="2.5"/>`;
      if (!label) return pin;
      const lines = wrap(label, 220, `600 14px ${FONT}`);
      const w = Math.max(140, Math.max(...lines.map((l) => measure(l, `600 14px ${FONT}`))) + 26);
      const card = `<rect x="${n(s.x + 34)}" y="${n(s.y - 2)}" width="${n(w)}" height="${n(lines.length * 19 + 34)}" rx="12" fill="${hex(theme.paper)}" stroke="${hex(theme.line)}"/>`;
      return `${pin}${card}${textBlock([s.author ?? ""], s.x + 44, s.y + 2, 11, 14, theme.muted, 700)}${textBlock(lines, s.x + 44, s.y + 20, 14, 19, theme.ink, 600)}`;
    }
  }
}

export function boardBounds(shapes: readonly ShapeView[], lookup: Lookup): Rect | undefined {
  return boundsOf(shapes.map((s) => (s.kind === "comment" && s.label ? { ...s, w: 300, h: 80 } : visualBounds(s, lookup))));
}

export function toSvg(shapes: readonly ShapeView[], lookup: Lookup, options: SvgOptions): { svg: string; width: number; height: number } {
  const { theme, padding = 40, text = true, background = true, maxShapes = Infinity } = options;
  const shown = shapes.length > maxShapes ? shapes.slice(0, maxShapes) : shapes;
  const bounds = boardBounds(shown, lookup) ?? { x: 0, y: 0, w: 400, h: 300 };
  const x = bounds.x - padding;
  const y = bounds.y - padding;
  const width = Math.ceil(bounds.w + padding * 2);
  const height = Math.ceil(bounds.h + padding * 2);
  const bg = background ? `<rect x="${n(x)}" y="${n(y)}" width="${width}" height="${height}" fill="${hex(theme.background)}"/>` : "";
  const body = shown.map((s) => shapeSvg(s, lookup, theme, text)).join("");
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${n(x)} ${n(y)} ${width} ${height}">${bg}${body}</svg>`,
    width,
    height,
  };
}

/** Rasterize an SVG string to a PNG blob at `scale`. */
export async function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    const maxSide = 8_192;
    const s = Math.min(scale, maxSide / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * s));
    canvas.height = Math.max(1, Math.round(height * s));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export const safeFilename = (title: string): string => title.replace(/[^\p{L}\p{N}\- ]+/gu, "").trim().replace(/\s+/g, "-").slice(0, 60) || "board";
