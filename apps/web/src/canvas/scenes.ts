/**
 * 3D scenes on the board. A scene3d shape stores this spec as JSON; it can come from the
 * AI or another user, so everything is validated and clamped before it's drawn.
 */
export type Primitive = "box" | "sphere" | "cylinder" | "cone" | "torus" | "plane" | "ring";
export type Motion = "none" | "spin" | "orbit" | "bob" | "pulse";
export type Backdrop = "space" | "studio" | "sky";

export const PRIMITIVES: readonly Primitive[] = ["box", "sphere", "cylinder", "cone", "torus", "plane", "ring"];
const MOTIONS: readonly Motion[] = ["none", "spin", "orbit", "bob", "pulse"];
const BACKDROPS: readonly Backdrop[] = ["space", "studio", "sky"];

export interface SceneObject {
  readonly shape: Primitive;
  readonly label: string;
  readonly color: string;
  readonly position: readonly [number, number, number];
  readonly size: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly motion: Motion;
  /** Orbit: radius and speed around the scene's center (or around `around`). */
  readonly orbitRadius: number;
  readonly speed: number;
  readonly glow: boolean;
}

export interface SceneSpec {
  readonly title: string;
  readonly backdrop: Backdrop;
  readonly objects: readonly SceneObject[];
}

const MAX_OBJECTS = 40;
const LIMIT = 30;

const num = (v: unknown, fallback: number, min = -LIMIT, max = LIMIT): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const vec = (v: unknown, fallback: readonly [number, number, number], min = -LIMIT, max = LIMIT): [number, number, number] => {
  const a = Array.isArray(v) ? v : [];
  return [num(a[0], fallback[0], min, max), num(a[1], fallback[1], min, max), num(a[2], fallback[2], min, max)];
};
const text = (v: unknown, max: number): string => (typeof v === "string" ? Array.from(v.replace(/\p{Cc}+/gu, " ").trim()).slice(0, max).join("") : "");

const NAMED: Record<string, string> = {
  red: "#ff5a5a", orange: "#ff8a3d", yellow: "#ffd24a", green: "#3fcf7a", teal: "#19c3a5", blue: "#3d7bff", purple: "#8b6cff",
  pink: "#ff5fa2", white: "#f2f2f2", gray: "#8a8f98", grey: "#8a8f98", black: "#1d2029", brown: "#a0683d", gold: "#ffc53d", silver: "#c9ced6",
};
const color = (v: unknown, i: number): string => {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return NAMED[s] ?? ["#3d7bff", "#ff8a3d", "#19c3a5", "#8b6cff", "#ffd24a", "#ff5fa2"][i % 6] ?? "#3d7bff";
};

/** Parse and validate a scene spec; undefined when there's nothing to draw. */
export function parseScene(data: string | undefined): SceneSpec | undefined {
  if (!data) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const objects = (Array.isArray(r.objects) ? r.objects : []).slice(0, MAX_OBJECTS).flatMap((o, i): SceneObject[] => {
    if (typeof o !== "object" || o === null) return [];
    const x = o as Record<string, unknown>;
    const shape = PRIMITIVES.includes(x.shape as Primitive) ? (x.shape as Primitive) : "box";
    let motion = MOTIONS.includes(x.motion as Motion) ? (x.motion as Motion) : "none";
    // Light sources (a sun, a lamp) sit still and spin: models often make them orbit too.
    if (x.glow === true && motion === "orbit") motion = "spin";
    return [
      {
        shape,
        label: text(x.label, 40),
        color: color(x.color, i),
        position: vec(x.position, [0, 0, 0]),
        size: vec(x.size, [1, 1, 1], 0.05, 20),
        rotation: vec(x.rotation, [0, 0, 0], -7, 7),
        motion,
        orbitRadius: num(x.orbitRadius, 0, 0, 25),
        speed: num(x.speed, 1, -5, 5),
        glow: x.glow === true,
      },
    ];
  });
  if (objects.length === 0) return undefined;
  return { title: text(r.title, 80), backdrop: BACKDROPS.includes(r.backdrop as Backdrop) ? (r.backdrop as Backdrop) : "studio", objects };
}

/** Radius that contains every object (for framing the camera). */
export function sceneRadius(spec: SceneSpec): number {
  let r = 2;
  for (const o of spec.objects) {
    const [x, y, z] = o.position;
    const extent = Math.max(...o.size) / 2 + (o.motion === "orbit" ? o.orbitRadius : 0);
    r = Math.max(r, Math.hypot(x, y, z) + extent);
  }
  return r;
}
