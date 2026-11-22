/**
 * The homepage story, as pure functions of one number: `t`, the scroll position in
 * chapter units (0 = hero … 6 = outro). The 3D scene reads `t` every frame and asks
 * these functions where everything is, so scrolling backwards just plays it in reverse
 * and nothing depends on scroll speed or history.
 */
export const CHAPTERS = 7;

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
/** 0 before a, 1 after b. */
export const seg = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a));
/** 0 → 1 → 0 across [a, b]. */
export const tri = (t: number, a: number, b: number): number => {
  const s = seg(t, a, b);
  return s < 0.5 ? s * 2 : (1 - s) * 2;
};
export const ease = (s: number): number => (s < 0.5 ? 4 * s * s * s : 1 - (-2 * s + 2) ** 3 / 2);
export const mix = (a: number, b: number, s: number): number => a + (b - a) * s;

export interface V3 {
  x: number;
  y: number;
  z: number;
}

const rand = (seed: number): number => {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
};

export const NOTES = [
  { label: "Launch 🚀", color: "#2f63ff", ink: "#ffffff" },
  { label: "Audience", color: "#a9cdff", ink: "#111318" },
  { label: "Pricing", color: "#ffd666", ink: "#111318" },
  { label: "Story", color: "#ffadc8", ink: "#111318" },
  { label: "Channels", color: "#a8e6b4", ink: "#111318" },
  { label: "Timeline", color: "#cdb8ff", ink: "#111318" },
  { label: "Risks", color: "#ffc49b", ink: "#111318" },
  { label: "Beta list", color: "#a9cdff", ink: "#111318" },
  { label: "Press kit", color: "#ffd666", ink: "#111318" },
  { label: "Demo video", color: "#ffadc8", ink: "#111318" },
  { label: "Landing page", color: "#a8e6b4", ink: "#111318" },
  { label: "Webinar", color: "#cdb8ff", ink: "#111318" },
  { label: "FAQ", color: "#ffc49b", ink: "#111318" },
  { label: "Onboarding", color: "#a9cdff", ink: "#111318" },
  { label: "Launch party 🎉", color: "#ffd666", ink: "#111318" },
] as const;

export const AI_NOTES = ["Prepare", "Build buzz", "Launch day", "Audience map", "Teaser posts", "Go live", "Pricing page", "Partner emails", "Follow-ups"] as const;

export const CURSORS = [
  { name: "Maya", color: "#ff4f8b" },
  { name: "Leo", color: "#19c3a5" },
  { name: "Ava", color: "#7b6cff" },
  { name: "Kai", color: "#ffb020" },
  { name: "Noah", color: "#2f9bff" },
  { name: "Zoe", color: "#ff6a3d" },
  { name: "Ivy", color: "#52d36b" },
  { name: "Sam", color: "#e85cff" },
] as const;

/** Where each note floats in the hero (a loose cloud above the board). */
const SCATTER: V3[] = NOTES.map((_, i) => ({
  x: (rand(i + 1) - 0.5) * 24,
  y: (rand(i + 7) - 0.5) * 8 + 2.5,
  z: 0.6 + rand(i + 13) * 2.6,
}));
const SCATTER_ROT = NOTES.map((_, i) => (rand(i + 21) - 0.5) * 1.1);

/** Chapter 1: a kanban, three columns of five. */
const KANBAN: V3[] = NOTES.map((_, i) => ({ x: -5 + (i % 3) * 5, y: 3 - Math.floor(i / 3) * 1.5, z: 0 }));

/** Chapter 2: a mind map. 0 = center, 1-6 = ring, 7-14 = outer ring. */
const MIND: V3[] = NOTES.map((_, i) => {
  if (i === 0) return { x: 0, y: 0, z: 0 };
  if (i <= 6) {
    const a = ((i - 1) / 6) * Math.PI * 2 + Math.PI / 6;
    return { x: Math.cos(a) * 4.1, y: Math.sin(a) * 2.7, z: 0 };
  }
  const a = ((i - 7) / 8) * Math.PI * 2 + Math.PI / 8;
  return { x: Math.cos(a) * 8.2, y: Math.sin(a) * 5.0, z: 0 };
});

/** Mind map edges (from, to). */
export const EDGES: ReadonlyArray<readonly [number, number]> = [
  ...[1, 2, 3, 4, 5, 6].map((i) => [0, i] as const),
  ...[7, 8, 9, 10, 11, 12, 13, 14].map((j) => [1 + ((j - 7) % 6), j] as const),
];

export interface NotePose extends V3 {
  rot: number;
  /** How high it's lifted (being dragged): drives the shadow. */
  lift: number;
  /** 0..1 glow (being edited, merged). */
  glow: number;
  opacity: number;
}

/** Where note i is at story time t. */
export function notePose(i: number, t: number, time: number): NotePose {
  const s = SCATTER[i] ?? { x: 0, y: 0, z: 0 };
  const k = KANBAN[i] ?? s;
  const m = MIND[i] ?? k;
  // Hero: drift.
  const drift = 1 - seg(t, 0.2, 0.9);
  let x = s.x + Math.sin(time * 0.4 + i) * 0.35 * drift;
  let y = s.y + Math.cos(time * 0.35 + i * 1.7) * 0.3 * drift;
  let z = s.z + Math.sin(time * 0.6 + i * 2.1) * 0.25 * drift;
  let rot = (SCATTER_ROT[i] ?? 0) + Math.sin(time * 0.3 + i) * 0.08 * drift;
  // 1: assemble into a kanban, one by one.
  const a1 = ease(seg(t, 0.35 + i * 0.035, 0.95 + i * 0.035));
  x = mix(x, k.x, a1);
  y = mix(y, k.y, a1);
  z = mix(z, k.z, a1);
  rot = mix(rot, 0, a1);
  // 2: many hands drag everything into a mind map at once.
  const a2 = ease(seg(t, 1.45 + (i % 8) * 0.03, 2.1 + (i % 8) * 0.03));
  x = mix(x, m.x, a2);
  y = mix(y, m.y, a2);
  const dragLift = Math.sin(Math.PI * a2) * 0.9;
  rot += Math.sin(Math.PI * a2) * 0.12 * (i % 2 ? 1 : -1);
  // 3: the board splits into two offline devices, then merges.
  const split = ease(seg(t, 3.05, 3.35)) * (1 - ease(seg(t, 3.7, 3.92)));
  const side = m.x === 0 ? (i % 2 ? 1 : -1) : Math.sign(m.x);
  x += side * 2.8 * split;
  rot += side * 0.05 * split;
  // 4: time travel rewinds the board to the kanban and back.
  const rewind = ease(tri(t, 4.05, 4.95));
  x = mix(x, k.x, rewind * 0.92);
  y = mix(y, k.y, rewind * 0.92);
  const editGlow = t > 3.35 && t < 3.7 && i % 4 === 1 ? 1 : 0;
  const mergeGlow = tri(t, 3.8, 4.05);
  return {
    x,
    y,
    z: z + dragLift + split * 0.4,
    rot,
    lift: dragLift + split * 0.4 + z * (1 - a1) * 0.3,
    glow: Math.max(editGlow * 0.8, mergeGlow),
    opacity: 1 - seg(t, 5.4, 5.9) * 0.6,
  };
}

/** Chapter 5: AI cards stream out of the orb into three columns. */
export const ORB: V3 = { x: 9.5, y: 4.2, z: 3 };
export function aiPose(i: number, t: number): NotePose {
  const p = ease(seg(t, 5.0 + i * 0.07, 5.25 + i * 0.07));
  const col = i % 3;
  const row = Math.floor(i / 3);
  const target = { x: 11 + col * 2.35, y: 1.6 - row * 1.45, z: 0 };
  return {
    x: mix(ORB.x, target.x, p),
    y: mix(ORB.y, target.y, p),
    z: mix(ORB.z, 0, p) + Math.sin(Math.PI * p) * 1.2,
    rot: (1 - p) * (col - 1) * 0.6,
    lift: Math.sin(Math.PI * p) * 1.2,
    glow: (1 - p) * 0.8,
    opacity: seg(t, 5.0 + i * 0.07, 5.06 + i * 0.07),
  };
}

export interface CameraPose {
  pos: V3;
  look: V3;
}

/** Camera keyframes, one per chapter (index = t), interpolated smoothly between. */
const CAMERA: CameraPose[] = [
  { pos: { x: 0, y: -10, z: 12 }, look: { x: 0, y: 0.6, z: 1.5 } },
  { pos: { x: 0, y: -5.5, z: 15 }, look: { x: 0, y: 0.2, z: 0 } },
  { pos: { x: 1, y: -10, z: 19 }, look: { x: 0.3, y: 0, z: 0 } },
  { pos: { x: 0, y: -13, z: 23 }, look: { x: 0, y: 0, z: 0 } },
  { pos: { x: -5, y: -10, z: 19 }, look: { x: 0, y: 0, z: 0 } },
  { pos: { x: 8, y: -6, z: 13 }, look: { x: 7, y: 0.5, z: 0 } },
  { pos: { x: 2, y: -26, z: 34 }, look: { x: 2, y: 0, z: 0 } },
];

export function cameraPose(t: number): CameraPose {
  const i = Math.min(CAMERA.length - 2, Math.max(0, Math.floor(t)));
  const a = CAMERA[i];
  const b = CAMERA[i + 1];
  if (!a || !b) return CAMERA[0] as CameraPose;
  const s = ease(clamp01(t - i));
  const v = (p: V3, q: V3): V3 => ({ x: mix(p.x, q.x, s), y: mix(p.y, q.y, s), z: mix(p.z, q.z, s) });
  return { pos: v(a.pos, b.pos), look: v(a.look, b.look) };
}

/** Which note each cursor works on in each chapter. */
export function cursorTarget(c: number, t: number): number {
  if (t < 1.4) return (c * 2) % NOTES.length;
  if (t < 3) return 7 + c; // the outer ring: each cursor drags one
  return c < 4 ? 1 + c : 7 + c;
}

export const CHAT: Record<number, readonly string[]> = {
  0: ["Ship it! 🚀", "", "Love this", "", "", "On it", "", ""],
  1: ["", "Moving this →", "", "Pricing?", "", "", "Done ✓", ""],
  2: ["Grabbing Beta list", "Press kit here", "", "", "Demo video ↗", "", "", "FAQ!"],
  3: ["(offline) still editing", "", "", "", "", "Wi-Fi died lol", "", ""],
  4: ["Wait, go back", "", "v12 had it", "", "", "", "", ""],
  5: ["", "AI, plan the launch", "", "", "", "", "Whoa", ""],
  6: ["", "", "", "", "", "", "", ""],
};
