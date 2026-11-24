/**
 * Vector illustrations. An `art` shape stores a list of simple shapes (circles, rects,
 * polygons, paths, text) on a 400×400 canvas, written by the AI or by hand. It's untrusted,
 * so every value is checked and the SVG is built here from the checked values: colours must
 * be hex, paths may only use move/line/curve commands, text is escaped.
 */
import { ART_BACKGROUNDS, ART_ICONS, drawBackground, drawIcon, type ArtBackground, type ArtIcon } from "./art-kit";
import { esc, fitSize, FONT, mix, n1 } from "./svg-kit";

type Kind = "circle" | "ellipse" | "rect" | "polygon" | "line" | "path" | "text";
const KINDS: readonly Kind[] = ["circle", "ellipse", "rect", "polygon", "line", "path", "text"];

export interface ArtShape {
  readonly type: Kind;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly r: number;
  readonly points: readonly number[];
  readonly d: string;
  readonly text: string;
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly opacity: number;
  readonly radius: number;
  readonly rotate: number;
}

export interface ArtItem {
  readonly icon: ArtIcon;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly color: string;
  readonly accent: string;
  readonly rotate: number;
}

export interface ArtSpec {
  readonly title: string;
  readonly background: string;
  readonly shapes: readonly ArtShape[];
  /** Composed from the drawing library (what the AI makes). */
  readonly scene?: {
    readonly background: ArtBackground;
    readonly color1: string;
    readonly color2: string;
    readonly items: readonly ArtItem[];
    readonly text: string;
    readonly textStyle: "none" | "title" | "badge" | "banner";
  };
}

const num = (v: unknown, d: number, min = -200, max = 600): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : d);
const hex = (v: unknown, d: string): string => {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (/^#[0-9a-f]{6}$/.test(s) || /^#[0-9a-f]{3}$/.test(s)) return s;
  if (s === "none" || s === "transparent") return "none";
  return d;
};
// Only absolute/relative move, line, curve and close commands with numbers.
const SAFE_PATH = /^[MLHVQCSTZmlhvqcstz0-9.,\s-]+$/;

export function parseArt(data: string | undefined): ArtSpec | undefined {
  if (!data) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const shapes = (Array.isArray(r.shapes) ? r.shapes : []).slice(0, 80).flatMap((x): ArtShape[] => {
    if (typeof x !== "object" || x === null) return [];
    const o = x as Record<string, unknown>;
    const type = KINDS.includes(o.type as Kind) ? (o.type as Kind) : undefined;
    if (!type) return [];
    const d = typeof o.d === "string" && o.d.length <= 2400 && SAFE_PATH.test(o.d) ? o.d : "";
    if (type === "path" && !d) return [];
    const points = (Array.isArray(o.points) ? o.points : []).slice(0, 64).map((p) => num(p, 0));
    if ((type === "polygon" && points.length < 6) || (type === "line" && points.length < 4)) return [];
    return [
      {
        type,
        x: num(o.x, 200),
        y: num(o.y, 200),
        w: num(o.w, 80, 0, 800),
        h: num(o.h, 80, 0, 800),
        r: num(o.r, 40, 0, 400),
        points,
        d,
        text: typeof o.text === "string" ? o.text.slice(0, 60) : "",
        fill: hex(o.fill, "#5b8cff"),
        stroke: hex(o.stroke, "none"),
        strokeWidth: num(o.strokeWidth, 0, 0, 40),
        opacity: num(o.opacity, 1, 0, 1),
        radius: num(o.radius, 0, 0, 200),
        rotate: num(o.rotate, 0, -360, 360),
      },
    ];
  });
  const items = (Array.isArray(r.items) ? r.items : []).slice(0, 12).flatMap((x): ArtItem[] => {
    if (typeof x !== "object" || x === null) return [];
    const o = x as Record<string, unknown>;
    if (!ART_ICONS.includes(o.icon as ArtIcon)) return [];
    return [{ icon: o.icon as ArtIcon, x: num(o.x, 200, 0, 400), y: num(o.y, 200, 0, 400), size: num(o.size, 160, 24, 320), color: hex(o.color, "#5b8cff"), accent: hex(o.accent, "#ffb547"), rotate: num(o.rotate, 0, -45, 45) }];
  });
  if (items.length > 0) {
    const style = ART_BACKGROUNDS.includes(r.background as ArtBackground) ? (r.background as ArtBackground) : "blob";
    const textStyle = (["none", "title", "badge", "banner"] as const).includes(r.textStyle as "none") ? (r.textStyle as "none" | "title" | "badge" | "banner") : "none";
    return {
      title: typeof r.title === "string" ? r.title.slice(0, 80) : "Illustration",
      background: "none",
      shapes: [],
      scene: { background: style, color1: hex(r.color1, "#5b8cff"), color2: hex(r.color2, "#22c3a6"), items: composeArt(items, typeof r.text === "string" && r.text.trim() !== "" && r.textStyle !== "none"), text: typeof r.text === "string" ? r.text.slice(0, 40) : "", textStyle: textStyle === "none" || !r.text ? "none" : textStyle },
    };
  }
  if (shapes.length === 0) return undefined;
  return { title: typeof r.title === "string" ? r.title.slice(0, 80) : "Illustration", background: hex(r.background, "#f6f3ec"), shapes };
}

function shapeSvg(s: ArtShape, i: number): string {
  const paint = `fill="${s.fill}" stroke="${s.stroke}" stroke-width="${n1(s.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"${s.opacity < 1 ? ` opacity="${n1(s.opacity)}"` : ""}`;
  const anim = `class="a-pop" style="--d:${Math.min(1600, i * 45)}ms"`;
  switch (s.type) {
    case "circle":
      return `<circle cx="${n1(s.x)}" cy="${n1(s.y)}" r="${n1(s.r)}" ${paint} ${anim}/>`;
    case "ellipse":
      return `<ellipse cx="${n1(s.x)}" cy="${n1(s.y)}" rx="${n1(s.w / 2)}" ry="${n1(s.h / 2)}" ${paint} ${anim}/>`;
    case "rect": {
      const rot = s.rotate ? ` transform="rotate(${n1(s.rotate)} ${n1(s.x + s.w / 2)} ${n1(s.y + s.h / 2)})"` : "";
      return `<rect x="${n1(s.x)}" y="${n1(s.y)}" width="${n1(s.w)}" height="${n1(s.h)}" rx="${n1(s.radius)}" ${paint}${rot} ${anim}/>`;
    }
    case "polygon": {
      const pts: string[] = [];
      for (let k = 0; k + 1 < s.points.length; k += 2) pts.push(`${n1(s.points[k] ?? 0)},${n1(s.points[k + 1] ?? 0)}`);
      return `<polygon points="${pts.join(" ")}" ${paint} ${anim}/>`;
    }
    case "line":
      return `<line x1="${n1(s.points[0] ?? 0)}" y1="${n1(s.points[1] ?? 0)}" x2="${n1(s.points[2] ?? 0)}" y2="${n1(s.points[3] ?? 0)}" stroke="${s.stroke === "none" ? s.fill : s.stroke}" stroke-width="${n1(Math.max(1, s.strokeWidth))}" stroke-linecap="round" ${anim}/>`;
    case "path":
      return `<path d="${esc(s.d)}" ${paint} ${anim}/>`;
    case "text":
      return `<text x="${n1(s.x)}" y="${n1(s.y)}" text-anchor="middle" font-family="${FONT}" font-size="${n1(Math.max(8, Math.min(80, s.h || 28)))}" font-weight="800" fill="${s.fill}" ${anim}>${esc(s.text)}</text>`;
  }
}

function sceneSvg(scene: NonNullable<ArtSpec["scene"]>): string {
  const parts = [drawBackground(scene.background, scene.color1, scene.color2)];
  // Small things behind big things, then top to bottom.
  const items = [...scene.items].sort((a, b) => b.size - a.size);
  items.forEach((it, i) => {
    const k = it.size / 100;
    const ground = it.y + it.size / 2;
    parts.push(`<ellipse cx="${n1(it.x)}" cy="${n1(Math.min(392, ground - 2))}" rx="${n1(it.size * 0.34)}" ry="${n1(it.size * 0.05)}" fill="#000" opacity="0.12" class="a-fade" style="--d:${i * 90}ms"/>`);
    parts.push(`<g class="a-pop" style="--d:${i * 110}ms"><g transform="translate(${n1(it.x - it.size / 2)} ${n1(it.y - it.size / 2)}) rotate(${n1(it.rotate)} ${n1(it.size / 2)} ${n1(it.size / 2)}) scale(${n1(k)})">${drawIcon(it.icon, it.color, it.accent)}</g></g>`);
  });
  const t = scene.text.trim();
  if (t && scene.textStyle !== "none") {
    const main = scene.items[0]?.color ?? "#1d2440";
    if (scene.textStyle === "badge") {
      const size = fitSize(t.toUpperCase(), 260, 34, 14, 900, 1);
      parts.push(`<g class="a-up" style="--d:600ms"><rect x="60" y="318" width="280" height="56" rx="28" fill="${mix(main, "#000000", 0.35)}"/><text x="200" y="${n1(346 + size * 0.36)}" text-anchor="middle" font-family="${FONT}" font-size="${n1(size)}" font-weight="900" letter-spacing="2" fill="#ffffff">${esc(t.toUpperCase())}</text></g>`);
    } else if (scene.textStyle === "banner") {
      const size = fitSize(t, 250, 28, 12, 800, 1);
      parts.push(`<g class="a-up" style="--d:600ms"><path d="M40 330 L360 330 L344 352 L360 374 L40 374 L56 352 Z" fill="${main}"/><text x="200" y="${n1(352 + size * 0.36)}" text-anchor="middle" font-family="${FONT}" font-size="${n1(size)}" font-weight="800" fill="#ffffff">${esc(t)}</text></g>`);
    } else {
      const size = fitSize(t, 340, 30, 12, 800, 1);
      parts.push(`<text x="200" y="378" text-anchor="middle" font-family="${FONT}" font-size="${n1(size)}" font-weight="800" fill="${mix(main, "#000000", 0.45)}" class="a-up" style="--d:600ms">${esc(t)}</text>`);
    }
  }
  return parts.join("");
}

/** Draw the illustration as a card of size w×h (the 400×400 art is centred). */
export function artSvg(spec: ArtSpec, w: number, h: number): string {
  if (spec.scene) return `<svg xmlns="http://www.w3.org/2000/svg" width="${n1(w)}" height="${n1(h)}" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice"><clipPath id="ac"><rect width="400" height="400" rx="18"/></clipPath><g clip-path="url(#ac)">${sceneSvg(spec.scene)}</g></svg>`;
  const body = spec.shapes.map(shapeSvg).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n1(w)}" height="${n1(h)}" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid meet"><rect x="-1000" y="-1000" width="2400" height="2400" fill="${spec.background === "none" ? "#ffffff" : spec.background}"/>${body}</svg>`;
}

const SKY: readonly ArtIcon[] = ["sun", "moon", "cloud", "star", "planet", "rocket", "heart", "lightbulb"];
const DECOR: readonly ArtIcon[] = ["star", "cloud", "tree", "pine", "flower", "heart", "coin"];

/**
 * Lay out what the AI picked so it always reads well: the biggest item is the hero,
 * centred and large; repeats are dropped (except small decorations); sky things go up top,
 * everything else to the lower corners; room is left for a logo or caption.
 */
export function composeArt(items: readonly ArtItem[], withText: boolean): ArtItem[] {
  const sorted = [...items].sort((a, b) => b.size - a.size);
  const hero = sorted[0];
  if (!hero) return [];
  const seen = new Set<ArtIcon>([hero.icon]);
  const rest = sorted.slice(1).filter((it) => {
    if (seen.has(it.icon) && !DECOR.includes(it.icon)) return false;
    seen.add(it.icon);
    return true;
  });
  const bottom = withText ? 300 : 360;
  const heroSize = withText ? 210 : 240;
  const out: ArtItem[] = [{ ...hero, x: 200, y: withText ? 168 : 205, size: heroSize, rotate: Math.max(-10, Math.min(10, hero.rotate)) }];
  const skySlots: Array<[number, number]> = [[78, 78], [322, 82], [200, 40], [40, 150], [360, 160]];
  const groundSlots: Array<[number, number]> = [[66, bottom - 52], [334, bottom - 52], [120, bottom - 20], [280, bottom - 20]];
  for (const it of rest.slice(0, 6)) {
    const slots = SKY.includes(it.icon) ? skySlots : groundSlots;
    const slot = slots.shift() ?? skySlots.shift() ?? groundSlots.shift();
    if (!slot) break;
    out.push({ ...it, x: slot[0], y: slot[1], size: Math.max(48, Math.min(SKY.includes(it.icon) ? 78 : 96, it.size)) });
  }
  return out;
}
