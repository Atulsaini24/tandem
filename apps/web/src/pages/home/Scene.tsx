import { Html, Line, Sparkles } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { AI_NOTES, CHAT, CURSORS, EDGES, NOTES, ORB, aiPose, cameraPose, cursorTarget, ease, mix, notePose, seg, tri, type NotePose } from "./story";

/** Shared per-frame state: the smoothed story time and every note's pose. */
export interface StoryState {
  /** Where scrolling says we should be (chapter units). */
  target: number;
  /** Smoothed: what's on screen. */
  t: number;
  time: number;
  poses: NotePose[];
}

const NOTE_W = 1.9;
const NOTE_H = 1.15;

// --- textures --------------------------------------------------------------------------

function noteTexture(label: string, color: string, ink: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 310;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, 310);
    g.addColorStop(0, color);
    g.addColorStop(1, shade(color, -0.08));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(0, 0, 512, 310, 34);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(28, 26, 64, 8);
    ctx.fillStyle = ink;
    ctx.font = "700 58px Inter, Helvetica Neue, Arial, sans-serif";
    const words = label.split(" ");
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > 440 && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
    lines.slice(0, 3).forEach((l, i) => ctx.fillText(l, 34, 112 + i * 66));
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number): number => Math.round(Math.min(255, Math.max(0, c + c * amount)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function shadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    g.addColorStop(0, "rgba(0,0,0,0.55)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(canvas);
}

// --- shaders ------------------------------------------------------------------------------

const auroraVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

/** Slow aurora: layered value noise tinted between three brand colors. */
const auroraFragment = /* glsl */ `
  uniform float uTime;
  uniform float uMood;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; } return v; }
  void main() {
    vec2 p = vUv * 3.0;
    float n = fbm(p + vec2(uTime * 0.03, -uTime * 0.02));
    float m = fbm(p * 1.7 - vec2(uTime * 0.02, uTime * 0.035) + n);
    vec3 blue = vec3(0.10, 0.22, 0.75);
    vec3 coral = vec3(0.95, 0.38, 0.25);
    vec3 violet = vec3(0.42, 0.20, 0.80);
    vec3 col = mix(blue, violet, smoothstep(0.3, 0.8, n));
    col = mix(col, coral, smoothstep(0.55, 0.9, m) * (0.55 + 0.45 * uMood));
    float vignette = smoothstep(1.0, 0.15, length(vUv - 0.5) * 1.6);
    gl_FragColor = vec4(col * (0.10 + 0.42 * m) * vignette, 1.0);
  }
`;

/** The board: a dark slate with a dot grid that fades out at the edges. */
const boardFragment = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    vec2 size = vec2(34.0, 20.0);
    vec2 p = vUv * size;
    vec2 cell = fract(p * 1.25) - 0.5;
    float dot = smoothstep(0.08, 0.02, length(cell));
    float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x) * smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.8, vUv.y);
    vec3 base = vec3(0.055, 0.063, 0.085);
    vec3 col = base + vec3(0.16, 0.18, 0.24) * dot;
    gl_FragColor = vec4(col, edge * 0.92);
  }
`;

// --- scene pieces ---------------------------------------------------------------------------

function StoryClock({ story }: { story: MutableRefObject<StoryState> }) {
  const { camera } = useThree();
  const look = useMemo(() => new THREE.Vector3(), []);
  useFrame((state, delta) => {
    const s = story.current;
    const dt = Math.min(delta, 0.05);
    s.t = THREE.MathUtils.damp(s.t, s.target, 3.2, dt);
    s.time = state.clock.elapsedTime;
    s.poses = NOTES.map((_, i) => notePose(i, s.t, s.time));
    const pose = cameraPose(s.t);
    // A gentle parallax from the pointer, on top of the scripted camera.
    const px = state.pointer.x * 0.9;
    const py = state.pointer.y * 0.6;
    camera.position.set(pose.pos.x + px, pose.pos.y + py, pose.pos.z);
    look.set(pose.look.x, pose.look.y, pose.look.z);
    camera.up.set(0, 0, 1);
    camera.lookAt(look);
  }, -1);
  return null;
}

function Backdrop({ story }: { story: MutableRefObject<StoryState> }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uMood: { value: 0 } }), []);
  useFrame(() => {
    uniforms.uTime.value = story.current.time;
    uniforms.uMood.value = tri(story.current.t, 2.6, 4.4) + seg(story.current.t, 4.8, 5.4);
  });
  return (
    <mesh position={[0, 30, -18]} rotation={[Math.PI / 2.6, 0, 0]}>
      <planeGeometry args={[220, 120]} />
      <shaderMaterial ref={material} uniforms={uniforms} vertexShader={auroraVertex} fragmentShader={auroraFragment} depthWrite={false} />
    </mesh>
  );
}

function Board({ story }: { story: MutableRefObject<StoryState> }) {
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  useFrame(() => {
    uniforms.uTime.value = story.current.time;
  });
  return (
    <mesh position={[0, 0, -0.08]}>
      <planeGeometry args={[34, 20]} />
      <shaderMaterial uniforms={uniforms} vertexShader={auroraVertex} fragmentShader={boardFragment} transparent depthWrite={false} />
    </mesh>
  );
}

function Note({
  index,
  label,
  color,
  ink,
  pose,
  story,
  geometry,
  shadow,
}: {
  index: number;
  label: string;
  color: string;
  ink: string;
  pose: (story: StoryState) => NotePose;
  story: MutableRefObject<StoryState>;
  geometry: THREE.BufferGeometry;
  shadow: THREE.Texture;
}) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.MeshStandardMaterial>(null);
  const face = useRef<THREE.MeshBasicMaterial>(null);
  const shade = useRef<THREE.Mesh>(null);
  const shadeMat = useRef<THREE.MeshBasicMaterial>(null);
  const texture = useMemo(() => noteTexture(label, color, ink), [label, color, ink]);
  const base = useMemo(() => new THREE.Color(color), [color]);
  useEffect(() => () => texture.dispose(), [texture]);
  useFrame(() => {
    const p = pose(story.current);
    const g = group.current;
    if (!g) return;
    g.position.set(p.x, p.y, p.z + 0.06);
    g.rotation.set(0, 0, p.rot);
    const visible = p.opacity > 0.01;
    g.visible = visible;
    if (body.current) {
      body.current.opacity = p.opacity;
      body.current.emissive.copy(base).multiplyScalar(p.glow * 0.9);
    }
    if (face.current) face.current.opacity = p.opacity;
    if (shade.current && shadeMat.current) {
      shade.current.visible = visible;
      shade.current.position.set(p.x + p.lift * 0.35, p.y - p.lift * 0.45, 0.005);
      const s = 1 + p.lift * 0.35;
      shade.current.scale.set(s, s, 1);
      shadeMat.current.opacity = p.opacity * Math.max(0.15, 0.75 - p.lift * 0.25);
    }
  });
  return (
    <>
      <mesh ref={shade}>
        <planeGeometry args={[NOTE_W * 1.5, NOTE_H * 1.7]} />
        <meshBasicMaterial ref={shadeMat} map={shadow} transparent depthWrite={false} />
      </mesh>
      <group ref={group} scale={index === 0 && !label.startsWith("Prepare") ? 1.25 : 1}>
        <mesh geometry={geometry}>
          <meshStandardMaterial ref={body} color={color} roughness={0.55} metalness={0.05} transparent />
        </mesh>
        <mesh position={[0, 0, 0.066]}>
          <planeGeometry args={[NOTE_W - 0.02, NOTE_H - 0.02]} />
          <meshBasicMaterial ref={face} map={texture} transparent toneMapped={false} />
        </mesh>
      </group>
    </>
  );
}

function Notes({ story }: { story: MutableRefObject<StoryState> }) {
  const geometry = useMemo(() => new RoundedBoxGeometry(NOTE_W, NOTE_H, 0.12, 4, 0.08), []);
  const shadow = useMemo(() => shadowTexture(), []);
  return (
    <>
      {NOTES.map((n, i) => (
        <Note
          key={n.label}
          index={i}
          label={n.label}
          color={n.color}
          ink={n.ink}
          story={story}
          geometry={geometry}
          shadow={shadow}
          pose={(s) => s.poses[i] ?? notePose(i, s.t, s.time)}
        />
      ))}
      {AI_NOTES.map((label, i) => (
        <Note
          key={label}
          index={i + 100}
          label={label}
          color={i < 3 ? "#111318" : ["#a9cdff", "#ffd666", "#a8e6b4"][i % 3] ?? "#ffd666"}
          ink={i < 3 ? "#ffffff" : "#111318"}
          story={story}
          geometry={geometry}
          shadow={shadow}
          pose={(s) => aiPose(i, s.t)}
        />
      ))}
    </>
  );
}

/** Mind-map connectors: drawn out from the center as the map forms, following the notes. */
function Edges({ story }: { story: MutableRefObject<StoryState> }) {
  const line = useRef<{ geometry: { setPositions(a: Float32Array): void }; material: THREE.Material & { opacity: number } } | null>(null);
  const positions = useMemo(() => new Float32Array(EDGES.length * 6), []);
  const initial = useMemo(() => EDGES.flatMap(() => [new THREE.Vector3(), new THREE.Vector3(0.001, 0, 0)]), []);
  useFrame(() => {
    const s = story.current;
    const l = line.current;
    if (!l) return;
    EDGES.forEach(([from, to], k) => {
      const a = s.poses[from];
      const b = s.poses[to];
      if (!a || !b) return;
      const f = ease(seg(s.t, 1.95 + (k < 6 ? 0 : 0.2) + (k % 6) * 0.03, 2.45 + (k < 6 ? 0 : 0.2) + (k % 6) * 0.03));
      positions.set([a.x, a.y, a.z + 0.02, mix(a.x, b.x, f), mix(a.y, b.y, f), mix(a.z, b.z, f) + 0.02], k * 6);
    });
    l.geometry.setPositions(positions);
    l.material.opacity = seg(s.t, 1.95, 2.1) * (1 - ease(tri(s.t, 4.05, 4.95)) * 0.95) * (1 - seg(s.t, 5.4, 5.9) * 0.7);
  });
  return (
    <Line
      ref={line as never}
      points={initial}
      segments
      color="#9fb8ff"
      lineWidth={2.4}
      transparent
      opacity={0}
      toneMapped={false}
    />
  );
}

function arrowGeometry(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  const pts: Array<[number, number]> = [
    [0, 0],
    [0, -0.62],
    [0.16, -0.46],
    [0.27, -0.7],
    [0.37, -0.65],
    [0.26, -0.42],
    [0.46, -0.42],
  ];
  pts.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

/** Eight people at work: each cursor heads for "its" note, drags it, chats. */
function Cursors({ story }: { story: MutableRefObject<StoryState> }) {
  const geometry = useMemo(() => arrowGeometry(), []);
  return (
    <>
      {CURSORS.map((c, i) => (
        <CursorBot key={c.name} index={i} name={c.name} color={c.color} story={story} geometry={geometry} />
      ))}
    </>
  );
}

function CursorBot({ index, name, color, story, geometry }: { index: number; name: string; color: string; story: MutableRefObject<StoryState>; geometry: THREE.ShapeGeometry }) {
  const group = useRef<THREE.Group>(null);
  const label = useRef<HTMLDivElement>(null);
  const chat = useRef<HTMLDivElement>(null);
  const pos = useRef(new THREE.Vector3((index - 4) * 2, -6, 3));
  const lastChat = useRef("");
  useFrame((_, delta) => {
    const s = story.current;
    const target = s.poses[cursorTarget(index, s.t)];
    const g = group.current;
    if (!target || !g) return;
    const wobble = Math.max(0, 1 - seg(s.t, 1.45, 1.6) + seg(s.t, 2.3, 2.5));
    const goal = new THREE.Vector3(
      target.x + 0.35 + Math.sin(s.time * 1.3 + index * 2) * 0.55 * wobble,
      target.y - 0.15 + Math.cos(s.time * 1.1 + index) * 0.35 * wobble,
      target.z + 0.32,
    );
    // Chapter 5: everyone gathers around the AI orb.
    const gather = seg(s.t, 4.9, 5.2);
    if (gather > 0) {
      const a = (index / CURSORS.length) * Math.PI * 2 + s.time * 0.5;
      goal.lerp(new THREE.Vector3(ORB.x + Math.cos(a) * 2.2, ORB.y + Math.sin(a) * 1.4, ORB.z - 0.6), gather);
    }
    pos.current.x = THREE.MathUtils.damp(pos.current.x, goal.x, 6, delta);
    pos.current.y = THREE.MathUtils.damp(pos.current.y, goal.y, 6, delta);
    pos.current.z = THREE.MathUtils.damp(pos.current.z, goal.z, 6, delta);
    g.position.copy(pos.current);
    const visible = seg(s.t, -0.1, 0.15) * (1 - seg(s.t, 5.6, 5.9));
    g.visible = visible > 0.02;
    if (label.current) label.current.style.opacity = String(visible);
    const text = CHAT[Math.min(6, Math.floor(s.t + 0.15))]?.[index] ?? "";
    if (chat.current && text !== lastChat.current) {
      lastChat.current = text;
      chat.current.textContent = text;
      chat.current.style.display = text ? "block" : "none";
    }
  });
  return (
    <group ref={group}>
      <mesh geometry={geometry}>
        <meshBasicMaterial color={color} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <Html position={[0.42, -0.55, 0]} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        <div ref={label} style={{ transition: "opacity .2s" }}>
          <div className="whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold text-white shadow-lg" style={{ backgroundColor: color, boxShadow: `0 0 18px ${color}88` }}>
            {name}
          </div>
          <div ref={chat} className="mt-1 hidden max-w-[180px] rounded-2xl rounded-tl-sm px-2.5 py-1 text-[11px] font-semibold text-white" style={{ backgroundColor: color }} />
        </div>
      </Html>
    </group>
  );
}

/** Chapter 3: two devices editing apart, then the merge shockwave. Chapter 4: the clock. */
function Moments({ story }: { story: MutableRefObject<StoryState> }) {
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);
  const clock = useRef<THREE.Group>(null);
  const clockMat = useRef<THREE.MeshBasicMaterial>(null);
  const hand = useRef<THREE.Mesh>(null);
  const merged = useRef<HTMLDivElement>(null);
  const rewind = useRef<HTMLDivElement>(null);
  const devices = useRef<HTMLDivElement[]>([]);
  const frame = (w: number, h: number): THREE.Vector3[] => {
    const pts: THREE.Vector3[] = [];
    const r = 0.8;
    const corners: Array<[number, number, number]> = [
      [w / 2 - r, h / 2 - r, 0],
      [-w / 2 + r, h / 2 - r, Math.PI / 2],
      [-w / 2 + r, -h / 2 + r, Math.PI],
      [w / 2 - r, -h / 2 + r, (3 * Math.PI) / 2],
    ];
    for (const [cx, cy, start] of corners) for (let k = 0; k <= 8; k++) {
      const a = start + (k / 8) * (Math.PI / 2);
      pts.push(new THREE.Vector3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0.02));
    }
    pts.push(pts[0]?.clone() ?? new THREE.Vector3());
    return pts;
  };
  const framePts = useMemo(() => frame(10.8, 13), []);
  useFrame((_, delta) => {
    const s = story.current;
    const split = ease(seg(s.t, 3.05, 3.35)) * (1 - ease(seg(s.t, 3.7, 3.92)));
    for (const [g, side] of [
      [left.current, -1],
      [right.current, 1],
    ] as const) {
      if (!g) continue;
      g.visible = split > 0.01;
      g.position.x = side * (4.6 + 2.8 * split);
      g.traverse((o) => {
        const m = (o as THREE.Mesh).material as (THREE.Material & { opacity?: number }) | undefined;
        if (m && "opacity" in m) m.opacity = split;
      });
    }
    devices.current.forEach((d) => (d.style.opacity = String(split)));
    const shock = seg(s.t, 3.78, 4.2);
    if (ring.current && ringMat.current) {
      ring.current.visible = shock > 0 && shock < 1;
      const sc = 0.5 + shock * 14;
      ring.current.scale.set(sc, sc * 0.62, 1);
      ringMat.current.opacity = (1 - shock) * 0.9;
    }
    if (merged.current) merged.current.style.opacity = String(tri(s.t, 3.78, 4.35));
    const tt = tri(s.t, 4.02, 4.98);
    if (clock.current && clockMat.current && hand.current) {
      clock.current.visible = tt > 0.01;
      clockMat.current.opacity = tt;
      clock.current.rotation.z += delta * (s.t < 4.5 ? 1.8 : -1.8) * tt;
      hand.current.rotation.z = -s.time * 3;
    }
    if (rewind.current) {
      rewind.current.style.opacity = String(tt);
      const v = Math.round(mix(128, 12, ease(tri(s.t, 4.05, 4.95))));
      rewind.current.textContent = `⟲  version ${v}`;
    }
  });
  const deviceLabel = (side: number, text: string, color: string) => (
    <Html position={[side * 0, 7.1, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
      <div
        ref={(el) => {
          if (el && !devices.current.includes(el)) devices.current.push(el);
        }}
        className="whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-bold text-white"
        style={{ backgroundColor: color, opacity: 0, boxShadow: `0 0 24px ${color}` }}
      >
        {text}
      </div>
    </Html>
  );
  return (
    <>
      <group ref={left}>
        <Line points={framePts} color="#ff6a3d" lineWidth={2.5} transparent opacity={0} dashed dashSize={0.4} gapSize={0.25} toneMapped={false} />
        {deviceLabel(-1, "📴  Maya's laptop · offline", "#ff6a3d")}
      </group>
      <group ref={right}>
        <Line points={framePts} color="#19c3a5" lineWidth={2.5} transparent opacity={0} dashed dashSize={0.4} gapSize={0.25} toneMapped={false} />
        {deviceLabel(1, "📴  Leo's phone · offline", "#19c3a5")}
      </group>
      <mesh ref={ring} position={[0, 0, 0.1]}>
        <ringGeometry args={[0.96, 1, 96]} />
        <meshBasicMaterial ref={ringMat} color="#7ef0c3" transparent toneMapped={false} />
      </mesh>
      <Html position={[0, -6.6, 0.5]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        <div ref={merged} className="whitespace-nowrap rounded-full bg-[#1e8f5a] px-4 py-1.5 text-[13px] font-bold text-white shadow-[0_0_30px_#1e8f5a]" style={{ opacity: 0 }}>
          ✓ Merged · 0 conflicts · nothing lost
        </div>
      </Html>
      <group ref={clock} position={[0, 0, 0.05]} scale={[1.5, 1, 1]}>
        <mesh>
          <ringGeometry args={[7.6, 7.72, 160]} />
          <meshBasicMaterial ref={clockMat} color="#8fb0ff" transparent toneMapped={false} />
        </mesh>
        {Array.from({ length: 24 }, (_, k) => (
          <mesh key={k} position={[Math.cos((k / 24) * Math.PI * 2) * 7.35, Math.sin((k / 24) * Math.PI * 2) * 7.35, 0]} rotation={[0, 0, (k / 24) * Math.PI * 2]}>
            <planeGeometry args={[k % 6 === 0 ? 0.5 : 0.22, 0.05]} />
            <meshBasicMaterial color="#8fb0ff" toneMapped={false} />
          </mesh>
        ))}
        <mesh ref={hand}>
          <planeGeometry args={[0.06, 6.6]} />
          <meshBasicMaterial color="#c9d8ff" toneMapped={false} />
        </mesh>
      </group>
      <Html position={[0, 8.6, 0.5]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        <div ref={rewind} className="whitespace-nowrap rounded-full border border-white/20 bg-black/50 px-4 py-1.5 font-mono text-[13px] font-bold text-[#c9d8ff] backdrop-blur" style={{ opacity: 0 }} />
      </Html>
    </>
  );
}

function Orb({ story }: { story: MutableRefObject<StoryState> }) {
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);
  useFrame(() => {
    const s = story.current;
    const show = ease(seg(s.t, 4.8, 5.05)) * (1 - seg(s.t, 5.7, 5.95));
    const g = group.current;
    if (!g) return;
    g.visible = show > 0.01;
    g.scale.setScalar(0.2 + show * (1 + Math.sin(s.time * 3) * 0.05));
    if (core.current) core.current.rotation.set(s.time * 0.6, s.time * 0.4, 0);
    if (light.current) light.current.intensity = show * 40;
  });
  return (
    <group ref={group} position={[ORB.x, ORB.y, ORB.z]}>
      <mesh ref={core}>
        <icosahedronGeometry args={[0.85, 2]} />
        <meshStandardMaterial color="#ffffff" emissive="#7b6cff" emissiveIntensity={2.4} roughness={0.2} flatShading />
      </mesh>
      <mesh>
        <sphereGeometry args={[1.35, 32, 32]} />
        <meshBasicMaterial color="#ff8a5b" transparent opacity={0.12} toneMapped={false} />
      </mesh>
      <Sparkles count={70} scale={5} size={5} speed={0.8} color="#ffd1a8" />
      <pointLight ref={light} color="#9c8bff" distance={18} />
    </group>
  );
}

/** Outro: a constellation of boards (everyone else's ideas) around ours. */
function Constellation({ story }: { story: MutableRefObject<StoryState> }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const count = 70;
  const seeds = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const a = (i / count) * Math.PI * 2 * 3.1;
        const r = 18 + ((i * 37) % 17);
        return { x: Math.cos(a) * r * 1.3, y: Math.sin(a) * r, z: ((i * 13) % 9) - 3, s: 0.7 + ((i * 7) % 5) * 0.25, d: i * 0.004 };
      }),
    [],
  );
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colors = useMemo(() => ["#2f63ff", "#ff8a5b", "#7b6cff", "#19c3a5", "#ffd666", "#ff4f8b"], []);
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    seeds.forEach((_, i) => m.setColorAt(i, new THREE.Color(colors[i % colors.length])));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [seeds, colors]);
  useFrame(() => {
    const s = story.current;
    const m = mesh.current;
    if (!m) return;
    const show = seg(s.t, 5.35, 6);
    m.visible = show > 0.01;
    seeds.forEach((seed, i) => {
      const p = ease(seg(show, seed.d * 2, seed.d * 2 + 0.6));
      dummy.position.set(seed.x * mix(0.4, 1, p), seed.y * mix(0.4, 1, p), seed.z + Math.sin(s.time + i) * 0.3);
      dummy.rotation.set(0, 0, Math.sin(s.time * 0.2 + i) * 0.2);
      dummy.scale.setScalar(seed.s * p);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]}>
      <planeGeometry args={[3, 1.9]} />
      <meshBasicMaterial transparent opacity={0.85} toneMapped={false} />
    </instancedMesh>
  );
}

export function StoryScene({ story }: { story: MutableRefObject<StoryState> }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // Note textures are drawn with Inter: wait for it, or the first frames use a fallback font.
    let alive = true;
    void Promise.race([document.fonts.load("700 58px Inter"), new Promise((r) => setTimeout(r, 1200))]).then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ fov: 38, near: 0.1, far: 400, position: [0, -10, 12] }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => gl.setClearColor("#05060a")}
    >
      <StoryClock story={story} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[-6, -8, 14]} intensity={1.6} />
      <Backdrop story={story} />
      <Board story={story} />
      {ready && <Notes story={story} />}
      <Edges story={story} />
      <Moments story={story} />
      <Orb story={story} />
      <Constellation story={story} />
      <Cursors story={story} />
      <EffectComposer multisampling={0}>
        <Bloom mipmapBlur intensity={0.85} luminanceThreshold={0.62} luminanceSmoothing={0.2} />
        <Noise opacity={0.035} />
        <Vignette offset={0.25} darkness={0.75} />
      </EffectComposer>
    </Canvas>
  );
}
