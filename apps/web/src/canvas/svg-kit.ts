/**
 * Small helpers for the SVG designs (charts, slides). Text is measured with a fixed width
 * table rather than the DOM, so a design comes out identical in the renderer, in export,
 * in the animated overlay and in tests.
 */
// Rasterized SVG can't use the page's web fonts, so designs use system fonts only: the
// live overlay and the still texture then look exactly alike.
export const FONT = "'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif";

export const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const n1 = (v: number): string => (Math.round(v * 10) / 10).toString();

/** Rough advance width of a string in px (good to a few percent for sans-serif fonts). */
export function textWidth(s: string, size: number, weight = 400): number {
  let w = 0;
  for (const ch of s) {
    if (/[\u{1F000}-\u{1FFFF}☀-➿]/u.test(ch)) w += 1.15;
    else if (/[MW@%]/.test(ch)) w += 0.86;
    else if (/[A-Z0-9#$€£₹&]/.test(ch)) w += 0.64;
    else if (/[mw]/.test(ch)) w += 0.8;
    else if (/[iljtfrI.,:;'!|() ]/.test(ch)) w += 0.3;
    else w += 0.54;
  }
  return w * size * (weight >= 700 ? 1.06 : 1);
}

/** Greedy word wrap; the last kept line gets an ellipsis when text is cut. */
export function wrapText(text: string, maxWidth: number, size: number, weight = 400, maxLines = 6): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, size, weight) <= maxWidth || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1] ?? "";
    while (last.length > 1 && textWidth(`${last}…`, size, weight) > maxWidth) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last.replace(/[\s,.;:]+$/, "")}…`;
    return kept;
  }
  // A single word wider than the box: cut it.
  return lines.map((l) => {
    if (textWidth(l, size, weight) <= maxWidth * 1.02) return l;
    let cut = l;
    while (cut.length > 1 && textWidth(`${cut}…`, size, weight) > maxWidth) cut = cut.slice(0, -1);
    return `${cut}…`;
  });
}

/** Largest font size (≤ max) at which `text` fits in `maxWidth` on `lines` lines. */
export function fitSize(text: string, maxWidth: number, max: number, min: number, weight = 700, lines = 1): number {
  for (let size = max; size > min; size -= 1) {
    if (wrapText(text, maxWidth, size, weight, 99).length <= lines) return size;
  }
  return min;
}

export interface TextOpts {
  readonly size: number;
  readonly fill: string;
  readonly weight?: number;
  readonly lineHeight?: number;
  readonly anchor?: "start" | "middle" | "end";
  readonly opacity?: number;
  readonly letterSpacing?: number;
  /** Animation hook for the live overlay (see Reveal). */
  readonly cls?: string;
  readonly delay?: number;
}

/** Multi-line text; `y` is the first baseline. */
export function textLines(lines: readonly string[], x: number, y: number, o: TextOpts): string {
  if (lines.length === 0) return "";
  const lh = o.lineHeight ?? o.size * 1.25;
  const attrs = [
    `x="${n1(x)}"`,
    `y="${n1(y)}"`,
    `font-family="${FONT}"`,
    `font-size="${n1(o.size)}"`,
    `font-weight="${o.weight ?? 400}"`,
    `fill="${o.fill}"`,
    o.anchor && o.anchor !== "start" ? `text-anchor="${o.anchor}"` : "",
    o.opacity !== undefined ? `fill-opacity="${o.opacity}"` : "",
    o.letterSpacing ? `letter-spacing="${o.letterSpacing}"` : "",
    anim(o.cls, o.delay),
  ]
    .filter(Boolean)
    .join(" ");
  const spans = lines.map((l, i) => `<tspan x="${n1(x)}" dy="${i === 0 ? 0 : n1(lh)}">${esc(l)}</tspan>`).join("");
  return `<text ${attrs}>${spans}</text>`;
}

/** Class + delay attributes the reveal overlay animates (ignored when rasterized). */
export function anim(cls: string | undefined, delay = 0): string {
  if (!cls) return "";
  return `class="${cls}" style="--d:${Math.round(delay)}ms"`;
}

/** Positive / negative look for a delta like "+12%", "-3", "↑ 4x". */
export function deltaTone(delta: string): "up" | "down" | "flat" {
  const t = delta.trim();
  if (/^[+↑▲]/.test(t)) return "up";
  if (/^[-−↓▼]/.test(t)) return "down";
  return "flat";
}

/** Mix a hex color toward another (t = 0 → a, 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (p: number, s: number): number => (p >> s) & 255;
  const c = (s: number): number => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t);
  return `#${((1 << 24) + (c(16) << 16) + (c(8) << 8) + c(0)).toString(16).slice(1)}`;
}

/** Catmull-Rom spline through points as a cubic Bézier path, kept inside [top, bottom]. */
export function smoothPath(pts: ReadonlyArray<readonly [number, number]>, top: number, bottom: number): string {
  if (pts.length === 0) return "";
  const first = pts[0];
  if (!first) return "";
  if (pts.length < 3) return pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${n1(x)},${n1(y)}`).join(" ");
  const clampY = (y: number): number => Math.min(bottom, Math.max(top, y));
  let d = `M${n1(first[0])},${n1(first[1])}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    if (!p0 || !p1 || !p2 || !p3) continue;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = clampY(p1[1] + (p2[1] - p0[1]) / 6);
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = clampY(p2[1] - (p3[1] - p1[1]) / 6);
    d += ` C${n1(c1x)},${n1(c1y)} ${n1(c2x)},${n1(c2y)} ${n1(p2[0])},${n1(p2[1])}`;
  }
  return d;
}

/** Donut / pie slice path between two angles. */
export function arcPath(cx: number, cy: number, r: number, inner: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (a: number, rr: number): string => `${n1(cx + Math.cos(a) * rr)},${n1(cy + Math.sin(a) * rr)}`;
  if (inner <= 0) return `M${n1(cx)},${n1(cy)} L${p(a0, r)} A${n1(r)},${n1(r)} 0 ${large} 1 ${p(a1, r)} Z`;
  return `M${p(a0, r)} A${n1(r)},${n1(r)} 0 ${large} 1 ${p(a1, r)} L${p(a1, inner)} A${n1(inner)},${n1(inner)} 0 ${large} 0 ${p(a0, inner)} Z`;
}
