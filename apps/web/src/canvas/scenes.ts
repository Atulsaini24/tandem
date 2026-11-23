/**
 * 3D scenes on the board. A scene3d shape stores this spec as JSON; it can come from the
 * AI or another user, so everything is validated and clamped before it's drawn.
 */
export type Primitive =
  | "box" | "sphere" | "cylinder" | "cone" | "torus" | "plane" | "ring"
  // Ready-made models, built from several meshes (see ui/Scenes3D.tsx).
  | "planet" | "tree" | "pine" | "building" | "house" | "rocket" | "cloud" | "mountain" | "car" | "person" | "server" | "crystal";
export type Motion = "none" | "spin" | "orbit" | "bob" | "pulse" | "float";
export type Backdrop = "space" | "studio" | "sky" | "sunset" | "night";
export type Material = "matte" | "plastic" | "metal" | "glass";

export const PRIMITIVES: readonly Primitive[] = ["box", "sphere", "cylinder", "cone", "torus", "plane", "ring", "planet", "tree", "pine", "building", "house", "rocket", "cloud", "mountain", "car", "person", "server", "crystal"];
const MOTIONS: readonly Motion[] = ["none", "spin", "orbit", "bob", "pulse", "float"];
const BACKDROPS: readonly Backdrop[] = ["space", "studio", "sky", "sunset", "night"];
const MATERIALS: readonly Material[] = ["matte", "plastic", "metal", "glass"];

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
  readonly material: Material;
  /** Planets: a Saturn-like ring. */
  readonly rings: boolean;
}

export interface SceneSpec {
  readonly title: string;
  readonly backdrop: Backdrop;
  readonly objects: readonly SceneObject[];
}

const MAX_OBJECTS = 60;
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
        material: MATERIALS.includes(x.material as Material) ? (x.material as Material) : "matte",
        rings: x.rings === true,
      },
    ];
  });
  if (objects.length === 0) return undefined;
  const backdrop = BACKDROPS.includes(r.backdrop as Backdrop) ? (r.backdrop as Backdrop) : "studio";
  return { title: text(r.title, 80), backdrop, objects: compose(objects, backdrop) };
}

type Obj = { -readonly [K in keyof SceneObject]: SceneObject[K] };
const heightOf = (o: SceneObject): number => (o.shape === "sphere" || o.shape === "planet" ? o.size[0] : o.size[1]);
const footprint = (o: SceneObject): number => (Math.max(o.size[0], o.size[2]) / 2) * 0.92 + 0.15;
const FLAT: readonly Primitive[] = ["plane", "ring"];

/**
 * Turn whatever the model wrote into a scene that reads well: sensible scale, things on
 * the ground, flyers above the rooftops, no two objects inside each other, orbits that
 * clear what they circle, and a ground to stand on. Deterministic, so every viewer of the
 * board sees exactly the same scene.
 */
export function compose(input: readonly SceneObject[], backdrop: Backdrop): SceneObject[] {
  const objs: Obj[] = input.map((o) => ({ ...o, position: [...o.position], size: [...o.size] }) as Obj);
  const solid = objs.filter((o) => !FLAT.includes(o.shape));
  // 1. Scale: the biggest thing should be about 6 m, so the camera frames it nicely.
  const biggest = Math.max(1, ...solid.map((o) => Math.max(...o.size)));
  if (biggest > 8) {
    const k = 6 / biggest;
    for (const o of objs) {
      o.size = [o.size[0] * k, o.size[1] * k, o.size[2] * k];
      o.position = [o.position[0] * k, o.position[1] * k, o.position[2] * k];
      o.orbitRadius *= k;
    }
  }
  // Believable proportions for ready-made models, and nothing too small to see.
  for (const o of objs) {
    let [w, h, d] = o.size;
    if (o.shape === "building") [w, d] = [Math.min(w, h * 0.6), Math.min(d, h * 0.6)];
    else if (o.shape === "tree" || o.shape === "pine") w = d = h * 0.65;
    else if (o.shape === "cloud") [h, d] = [Math.max(h, w * 0.45), Math.max(d, w * 0.6)];
    else if (o.shape === "person") w = d = h * 0.4;
    else if (o.shape === "car") h = d = w * 0.5;
    else if (o.shape === "rocket") w = d = h * 0.45;
    else if (o.shape === "planet") h = d = w;
    const big = Math.max(w, h, d);
    const min = o.shape === "person" ? 0.9 : FLAT.includes(o.shape) ? 0 : 0.6;
    const k = big > 0 && big < min ? min / big : 1;
    o.size = [w * k, h * k, d * k];
  }
  if (backdrop === "space") {
    separate(objs.filter((o) => o.motion !== "orbit" && !FLAT.includes(o.shape)));
    return objs;
  }
  // 2. Ground: things stand on y = 0; clouds and flyers go above the tallest building.
  const flies = (o: Obj): boolean => o.shape === "cloud" || o.motion === "float" || (o.glow && o.shape !== "building" && o.shape !== "house" && o.shape !== "server");
  const grounded = objs.filter((o) => !FLAT.includes(o.shape) && !flies(o));
  const tallest = Math.max(1, ...grounded.map(heightOf));
  for (const o of grounded) o.position = [o.position[0], heightOf(o) / 2, o.position[2]];
  // 3. Nothing inside anything else (moving things are placed after).
  separate(grounded.filter((o) => o.motion !== "orbit"));
  const extent = Math.max(2, ...grounded.filter((o) => o.motion !== "orbit").map((o) => Math.hypot(o.position[0], o.position[2]) + footprint(o)));
  // 4. Orbits clear everything they circle.
  grounded.filter((o) => o.motion === "orbit").forEach((o, i) => {
    o.orbitRadius = Math.max(o.orbitRadius, extent + 1 + i * 0.8);
  });
  objs.filter(flies).forEach((o, i) => {
    const lift = o.shape === "cloud" ? tallest + 2 + (i % 3) * 0.8 : tallest * 0.7 + 1.2;
    o.position = [o.position[0], Math.max(o.position[1], lift), o.position[2]];
  });
  separate(objs.filter((o) => o.shape === "cloud"));
  // 5. A ground if there's none.
  const ground = objs.find((o) => o.shape === "plane");
  const reach = Math.max(extent, ...objs.filter((o) => o.motion === "orbit").map((o) => o.orbitRadius + footprint(o)));
  if (ground) {
    ground.position = [0, 0, 0];
    ground.size = [Math.max(ground.size[0], reach * 2.4), 0.1, Math.max(ground.size[2], reach * 2.4)];
  } else {
    const color = backdrop === "night" ? "#1d2230" : backdrop === "studio" ? "#2a2d35" : backdrop === "sunset" ? "#6b5a4a" : "#5f8f52";
    objs.unshift({ shape: "plane", label: "", color, position: [0, 0, 0], size: [reach * 2.4, 0.1, reach * 2.4], rotation: [0, 0, 0], motion: "none", orbitRadius: 0, speed: 1, glow: false, material: "matte", rings: false });
  }
  return objs;
}

/** Push overlapping footprints apart on the ground plane (a few relaxation passes). */
function separate(list: Obj[]): void {
  // Objects dumped on the same spot first get spread around a circle.
  list.forEach((o, i) => {
    const twins = list.filter((x) => Math.abs(x.position[0] - o.position[0]) < 0.01 && Math.abs(x.position[2] - o.position[2]) < 0.01);
    if (twins.length > 1 && twins[0] !== o) {
      const k = twins.indexOf(o);
      const a = k * 2.39996; // golden angle
      const d = 1 + Math.sqrt(k) * 1.6;
      o.position = [o.position[0] + Math.cos(a) * d, o.position[1], o.position[2] + Math.sin(a) * d];
    }
    void i;
  });
  for (let pass = 0; pass < 80; pass += 1) {
    let moved = false;
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        if (!a || !b) continue;
        const dx = b.position[0] - a.position[0];
        const dz = b.position[2] - a.position[2];
        const d = Math.hypot(dx, dz) || 0.001;
        const need = footprint(a) + footprint(b) + 0.25;
        if (d >= need) continue;
        const push = (need - d) / 2;
        const ux = d < 0.01 ? Math.cos(i + j) : dx / d;
        const uz = d < 0.01 ? Math.sin(i + j) : dz / d;
        a.position = [a.position[0] - ux * push, a.position[1], a.position[2] - uz * push];
        b.position = [b.position[0] + ux * push, b.position[1], b.position[2] + uz * push];
        moved = true;
      }
    }
    if (!moved) break;
  }
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
