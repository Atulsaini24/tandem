import type { ShapeView } from "@canvas/doc";
import { ContactShadows, Environment, Html, Lightformer, OrbitControls, Sky, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import type { Editor } from "../canvas/editor";
import { parseScene, sceneRadius, type Backdrop, type Material, type SceneObject, type SceneSpec } from "../canvas/scenes";
import { useUiStore } from "../state/ui-store";
import { useSceneVersion } from "./useScene";

const MAX_LIVE = 4;

// --- materials & procedural textures -------------------------------------------------

function Mat({ color, material, glow, opacity }: { color: string; material: Material; glow?: boolean; opacity?: number }) {
  const emissive = glow ? color : "#000000";
  const transparent = opacity !== undefined && opacity < 1;
  if (material === "glass") {
    return <meshPhysicalMaterial color={color} roughness={0.06} metalness={0} transmission={0.85} thickness={0.6} ior={1.45} clearcoat={1} emissive={emissive} emissiveIntensity={glow ? 1.6 : 0} transparent opacity={opacity ?? 0.9} />;
  }
  if (material === "metal") return <meshStandardMaterial color={color} roughness={0.22} metalness={0.9} envMapIntensity={1.2} emissive={emissive} emissiveIntensity={glow ? 2.2 : 0} toneMapped={!glow} transparent={transparent} opacity={opacity ?? 1} />;
  if (material === "plastic") return <meshPhysicalMaterial color={color} roughness={0.32} metalness={0} clearcoat={0.6} clearcoatRoughness={0.2} emissive={emissive} emissiveIntensity={glow ? 2.2 : 0} toneMapped={!glow} transparent={transparent} opacity={opacity ?? 1} />;
  return <meshStandardMaterial color={color} roughness={0.78} metalness={0.05} emissive={emissive} emissiveIntensity={glow ? 2.4 : 0} toneMapped={!glow} transparent={transparent} opacity={opacity ?? 1} />;
}

const textureCache = new Map<string, THREE.Texture>();

/** Seeded pseudo-random numbers, so a planet looks the same every time it's drawn. */
function rng(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** A banded, speckled planet surface in shades of one color. */
function planetTexture(color: string, seed: string): THREE.Texture {
  const key = `planet|${color}|${seed}`;
  const hit = textureCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const base = new THREE.Color(color);
  const rand = rng(seed);
  if (ctx) {
    const bands = 7 + Math.floor(rand() * 10);
    for (let y = 0; y < 256; y += 1) {
      const t = y / 256;
      let v = 0;
      for (let k = 1; k <= 3; k += 1) v += Math.sin(t * Math.PI * bands * k + rand() * 0.05 + k * 1.7) / k;
      const c = base.clone().offsetHSL((rand() - 0.5) * 0.02, 0, v * 0.07);
      ctx.fillStyle = `#${c.getHexString()}`;
      ctx.fillRect(0, y, 512, 1);
    }
    // Storms and craters.
    for (let i = 0; i < 70; i += 1) {
      const c = base.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.25);
      ctx.fillStyle = `#${c.getHexString()}`;
      ctx.globalAlpha = 0.25 + rand() * 0.35;
      ctx.beginPath();
      ctx.ellipse(rand() * 512, rand() * 256, 4 + rand() * 22, 2 + rand() * 7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(key, texture);
  return texture;
}

/**
 * Window grid for buildings. `glowMap` is the night version's emissive map: black except
 * the lit windows, so only they glow, not the whole facade.
 */
function windowTexture(color: string, lit: boolean, glowMap = false): THREE.Texture {
  const key = `win|${color}|${lit}|${glowMap}`;
  const hit = textureCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const rand = rng(`win|${color}|${lit}`); // same pattern for the color and glow maps
  if (ctx) {
    ctx.fillStyle = glowMap ? "#000000" : color;
    ctx.fillRect(0, 0, 128, 256);
    for (let y = 8; y < 248; y += 16) {
      for (let x = 8; x < 120; x += 14) {
        const on = lit ? rand() > 0.58 : false;
        const warm = 200 + Math.floor(rand() * 40);
        if (glowMap) ctx.fillStyle = on ? `rgb(255, ${warm}, 140)` : "#000000";
        else ctx.fillStyle = on ? `rgba(255, ${warm}, 140, 0.95)` : "rgba(170, 205, 255, 0.45)";
        ctx.fillRect(x, y, 8, 10);
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  textureCache.set(key, texture);
  return texture;
}

// --- models (each built in a unit box, then scaled to the object's size) -------------

function Model({ o, index, night }: { o: SceneObject; index: number; night: boolean }) {
  const [sx, sy, sz] = o.size;
  const m = o.material;
  const c = o.color;
  switch (o.shape) {
    case "box":
      return (
        <mesh castShadow receiveShadow>
          <boxGeometry args={[sx, sy, sz]} />
          <Mat color={c} material={m} glow={o.glow} />
        </mesh>
      );
    case "sphere":
      return (
        <mesh castShadow receiveShadow>
          <sphereGeometry args={[sx / 2, 48, 48]} />
          <Mat color={c} material={m} glow={o.glow} />
        </mesh>
      );
    case "cylinder":
      return (
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[sx / 2, sx / 2, sy, 40]} />
          <Mat color={c} material={m} glow={o.glow} />
        </mesh>
      );
    case "cone":
      return (
        <mesh castShadow receiveShadow>
          <coneGeometry args={[sx / 2, sy, 40]} />
          <Mat color={c} material={m} glow={o.glow} />
        </mesh>
      );
    case "torus":
      return (
        <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[sx / 2, Math.max(0.04, sy / 6), 24, 80]} />
          <Mat color={c} material={m} glow={o.glow} />
        </mesh>
      );
    case "ring":
      return (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[sx / 2 - Math.max(0.03, sy / 10), sx / 2, 128]} />
          <meshBasicMaterial color={c} side={THREE.DoubleSide} transparent opacity={0.55} toneMapped={false} />
        </mesh>
      );
    case "plane":
      return (
        <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[sx, sz]} />
          <meshStandardMaterial color={c} roughness={0.95} metalness={0} />
        </mesh>
      );
    case "planet":
      return <Planet o={o} index={index} />;
    case "tree":
      return (
        <group scale={[sx, sy, sz]}>
          <mesh castShadow position={[0, -0.28, 0]}>
            <cylinderGeometry args={[0.07, 0.1, 0.45, 10]} />
            <meshStandardMaterial color="#7a4f2c" roughness={0.9} />
          </mesh>
          {[
            [0, 0.05, 0, 0.42],
            [0.14, 0.2, 0.06, 0.3],
            [-0.12, 0.24, -0.05, 0.28],
          ].map(([x, y, z, r], i) => (
            <mesh key={i} castShadow position={[x ?? 0, y ?? 0, z ?? 0]}>
              <icosahedronGeometry args={[r ?? 0.3, 1]} />
              <meshStandardMaterial color={new THREE.Color(c).offsetHSL(0, 0, i * 0.04 - 0.03)} roughness={0.8} flatShading />
            </mesh>
          ))}
        </group>
      );
    case "pine":
      return (
        <group scale={[sx, sy, sz]}>
          <mesh castShadow position={[0, -0.38, 0]}>
            <cylinderGeometry args={[0.05, 0.07, 0.25, 8]} />
            <meshStandardMaterial color="#6b4423" roughness={0.9} />
          </mesh>
          {[0, 1, 2].map((i) => (
            <mesh key={i} castShadow position={[0, -0.2 + i * 0.22, 0]}>
              <coneGeometry args={[0.42 - i * 0.11, 0.42, 9]} />
              <meshStandardMaterial color={new THREE.Color(c).offsetHSL(0, 0, i * 0.04)} roughness={0.85} flatShading />
            </mesh>
          ))}
        </group>
      );
    case "building": {
      const repeat = (tex: THREE.Texture): THREE.Texture => {
        const t = tex.clone();
        t.repeat.set(Math.max(1, Math.round(sx / 2.6)), Math.max(1, Math.round(sy / 4.5)));
        t.needsUpdate = true;
        return t;
      };
      const t = repeat(windowTexture(c, night));
      const glow = night ? repeat(windowTexture(c, night, true)) : null;
      return (
        <group>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[sx, sy, sz]} />
            <meshStandardMaterial map={t} emissiveMap={glow} emissive={night ? "#ffffff" : "#000000"} emissiveIntensity={night ? 1.4 : 0} roughness={0.35} metalness={0.35} />
          </mesh>
          <mesh castShadow position={[0, sy / 2 + 0.06, 0]}>
            <boxGeometry args={[sx * 1.04, 0.12, sz * 1.04]} />
            <meshStandardMaterial color={new THREE.Color(c).offsetHSL(0, 0, -0.12)} roughness={0.6} />
          </mesh>
          {night && (
            <mesh position={[0, sy / 2 + 0.3, 0]}>
              <sphereGeometry args={[0.06, 8, 8]} />
              <meshBasicMaterial color="#ff3b3b" toneMapped={false} />
            </mesh>
          )}
        </group>
      );
    }
    case "house":
      return (
        <group scale={[sx, sy, sz]}>
          <mesh castShadow receiveShadow position={[0, -0.2, 0]}>
            <boxGeometry args={[0.9, 0.6, 0.8]} />
            <Mat color={c} material="matte" />
          </mesh>
          <mesh castShadow position={[0, 0.3, 0]} rotation={[0, Math.PI / 4, 0]}>
            <coneGeometry args={[0.72, 0.42, 4]} />
            <meshStandardMaterial color="#b5442f" roughness={0.7} flatShading />
          </mesh>
          <mesh position={[0, -0.32, 0.401]}>
            <planeGeometry args={[0.18, 0.34]} />
            <meshStandardMaterial color="#5a3b22" />
          </mesh>
          {[-0.28, 0.28].map((x) => (
            <mesh key={x} position={[x, -0.12, 0.401]}>
              <planeGeometry args={[0.16, 0.14]} />
              <meshStandardMaterial color={night ? "#ffd27a" : "#9fd0ff"} emissive={night ? "#ffb347" : "#000000"} emissiveIntensity={night ? 2 : 0} toneMapped={!night} />
            </mesh>
          ))}
          <mesh castShadow position={[0.25, 0.42, -0.1]}>
            <boxGeometry args={[0.1, 0.24, 0.1]} />
            <meshStandardMaterial color="#6e6e6e" />
          </mesh>
        </group>
      );
    case "rocket":
      return <Rocket o={o} />;
    case "cloud":
      return (
        <group scale={[sx, sy, sz]}>
          {[
            [0, 0, 0, 0.34],
            [0.3, -0.05, 0.05, 0.26],
            [-0.3, -0.06, -0.02, 0.24],
            [0.12, 0.14, -0.06, 0.24],
            [-0.12, 0.1, 0.1, 0.22],
          ].map(([x, y, z, r], i) => (
            <mesh key={i} position={[x ?? 0, y ?? 0, z ?? 0]} castShadow>
              <sphereGeometry args={[r ?? 0.3, 24, 24]} />
              <meshStandardMaterial color={c} roughness={1} transparent opacity={0.96} />
            </mesh>
          ))}
        </group>
      );
    case "mountain":
      return (
        <group scale={[sx, sy, sz]}>
          <mesh castShadow receiveShadow>
            <coneGeometry args={[0.5, 1, 7, 3]} />
            <meshStandardMaterial color={c} roughness={0.95} flatShading />
          </mesh>
          <mesh position={[0, 0.34, 0]}>
            <coneGeometry args={[0.165, 0.33, 7]} />
            <meshStandardMaterial color="#f4f7fb" roughness={0.6} flatShading />
          </mesh>
        </group>
      );
    case "car":
      return (
        <group scale={[sx, sy, sz]}>
          <mesh castShadow position={[0, -0.12, 0]}>
            <boxGeometry args={[1, 0.36, 0.5]} />
            <Mat color={c} material={m === "matte" ? "plastic" : m} />
          </mesh>
          <mesh castShadow position={[-0.05, 0.16, 0]}>
            <boxGeometry args={[0.55, 0.26, 0.46]} />
            <meshPhysicalMaterial color="#1b2633" roughness={0.1} metalness={0.4} clearcoat={1} />
          </mesh>
          {[
            [0.32, 0.26],
            [-0.32, 0.26],
            [0.32, -0.26],
            [-0.32, -0.26],
          ].map(([x, z], i) => (
            <mesh key={i} castShadow position={[x ?? 0, -0.3, z ?? 0]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.12, 0.12, 0.08, 20]} />
              <meshStandardMaterial color="#15171c" roughness={0.6} />
            </mesh>
          ))}
          {[0.14, -0.14].map((z) => (
            <mesh key={z} position={[0.501, -0.1, z]}>
              <boxGeometry args={[0.01, 0.06, 0.1]} />
              <meshBasicMaterial color="#fff6d0" toneMapped={false} />
            </mesh>
          ))}
        </group>
      );
    case "person":
      return (
        <group scale={[sx, sy, sz]}>
          <mesh castShadow position={[0, -0.15, 0]}>
            <capsuleGeometry args={[0.18, 0.4, 8, 16]} />
            <Mat color={c} material="plastic" />
          </mesh>
          <mesh castShadow position={[0, 0.32, 0]}>
            <sphereGeometry args={[0.15, 24, 24]} />
            <meshStandardMaterial color="#f1c7a3" roughness={0.6} />
          </mesh>
        </group>
      );
    case "server":
      return <Server o={o} index={index} />;
    case "crystal":
      return (
        <group scale={[sx, sy, sz]}>
          <mesh castShadow scale={[0.5, 0.9, 0.5]}>
            <octahedronGeometry args={[0.6, 0]} />
            <meshPhysicalMaterial color={c} roughness={0.04} transmission={0.7} thickness={0.8} ior={1.6} clearcoat={1} emissive={c} emissiveIntensity={o.glow ? 1.4 : 0.15} toneMapped={!o.glow} flatShading />
          </mesh>
        </group>
      );
    default:
      return null;
  }
}

function Planet({ o, index }: { o: SceneObject; index: number }) {
  const r = o.size[0] / 2;
  const map = useMemo(() => planetTexture(o.color, `${o.label}|${index}`), [o.color, o.label, index]);
  const tilt = o.rings ? 0.45 : 0.18;
  return (
    <group rotation={[0, 0, tilt]}>
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[r, 64, 64]} />
        {o.glow ? <meshStandardMaterial map={map} emissive={o.color} emissiveMap={map} emissiveIntensity={2.6} toneMapped={false} /> : <meshStandardMaterial map={map} roughness={0.85} metalness={0.02} />}
      </mesh>
      {/* Atmosphere: a soft rim slightly bigger than the planet. */}
      <mesh scale={1.06}>
        <sphereGeometry args={[r, 48, 48]} />
        <meshBasicMaterial color={new THREE.Color(o.color).offsetHSL(0, 0, 0.2)} transparent opacity={o.glow ? 0.35 : 0.12} side={THREE.BackSide} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      {o.rings && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[r * 1.35, r * 2.2, 128]} />
          <meshStandardMaterial color={new THREE.Color(o.color).offsetHSL(0.02, -0.1, 0.12)} side={THREE.DoubleSide} transparent opacity={0.7} roughness={0.9} />
        </mesh>
      )}
    </group>
  );
}

function Rocket({ o }: { o: SceneObject }) {
  const flame = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const f = flame.current;
    if (f) f.scale.set(1, 0.85 + Math.sin(clock.elapsedTime * 30) * 0.15, 1);
  });
  const [sx, sy, sz] = o.size;
  return (
    <group scale={[sx, sy, sz]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.16, 0.2, 0.7, 32]} />
        <meshPhysicalMaterial color="#f3f5f8" roughness={0.25} metalness={0.3} clearcoat={1} />
      </mesh>
      <mesh castShadow position={[0, 0.5, 0]}>
        <coneGeometry args={[0.16, 0.3, 32]} />
        <Mat color={o.color} material="metal" />
      </mesh>
      <mesh position={[0, 0.12, 0.165]}>
        <circleGeometry args={[0.07, 24]} />
        <meshPhysicalMaterial color="#7fd4ff" emissive="#3ab7ff" emissiveIntensity={0.6} roughness={0.05} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} castShadow rotation={[0, (i * Math.PI * 2) / 3, 0]} position={[Math.sin((i * Math.PI * 2) / 3) * 0.2, -0.3, Math.cos((i * Math.PI * 2) / 3) * 0.2]}>
          <boxGeometry args={[0.03, 0.24, 0.18]} />
          <Mat color={o.color} material="metal" />
        </mesh>
      ))}
      <mesh ref={flame} position={[0, -0.52, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.13, 0.36, 24]} />
        <meshBasicMaterial color="#ffb347" toneMapped={false} transparent opacity={0.92} />
      </mesh>
    </group>
  );
}

function Server({ o, index }: { o: SceneObject; index: number }) {
  const leds = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    leds.current?.children.forEach((child, i) => {
      const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.opacity = 0.35 + 0.65 * (Math.sin(clock.elapsedTime * (2 + (i % 3)) + i * 1.3 + index) > 0.2 ? 1 : 0.2);
    });
  });
  const [sx, sy, sz] = o.size;
  const slots = Math.max(3, Math.min(12, Math.round(sy * 4)));
  return (
    <group>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[sx, sy, sz]} />
        <meshStandardMaterial color={o.color} roughness={0.35} metalness={0.8} />
      </mesh>
      <group ref={leds}>
        {Array.from({ length: slots }, (_, i) => (
          <mesh key={i} position={[-sx * 0.3, -sy / 2 + ((i + 0.5) * sy) / slots, sz / 2 + 0.005]}>
            <planeGeometry args={[sx * 0.25, (sy / slots) * 0.25]} />
            <meshBasicMaterial color={i % 4 === 0 ? "#ffb020" : "#37f0a0"} transparent toneMapped={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// --- motion & composition ------------------------------------------------------------

function Thing({ o, index, night }: { o: SceneObject; index: number; night: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const t = clock.elapsedTime * o.speed;
    const [x, y, z] = o.position;
    g.position.set(x, y, z);
    g.rotation.set(o.rotation[0], o.rotation[1], o.rotation[2]);
    g.scale.setScalar(1);
    if (o.motion === "spin") g.rotation.y = o.rotation[1] + t;
    if (o.motion === "bob") g.position.y = y + Math.sin(t * 2 + index) * 0.25;
    if (o.motion === "float") {
      g.position.y = y + Math.sin(t * 1.2 + index) * 0.18;
      g.rotation.z = o.rotation[2] + Math.sin(t * 0.8 + index) * 0.06;
    }
    if (o.motion === "pulse") g.scale.setScalar(1 + Math.sin(t * 3 + index) * 0.08);
    if (o.motion === "orbit") {
      const r = o.orbitRadius || Math.hypot(x, z) || 2;
      const a = t * (0.9 / Math.sqrt(Math.max(0.5, r))) + index * 2.4;
      g.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      g.rotation.y = t * 0.8;
    }
  });
  const [sx, sy] = o.size;
  const top = o.shape === "planet" || o.shape === "sphere" ? sx / 2 : Math.max(sy, 0.1) / 2;
  return (
    <group ref={ref}>
      <Model o={o} index={index} night={night} />
      {o.glow && <pointLight intensity={Math.min(60, 8 + sx * 10)} distance={Math.max(6, sx * 8)} color={o.color} decay={1.6} />}
      {o.label && (
        <Html position={[0, top + 0.4, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
          <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-white/15 bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg backdrop-blur-md">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: o.color }} />
            {o.label}
          </span>
        </Html>
      )}
    </group>
  );
}

/** Faint circles showing where orbiting things travel. */
function OrbitPaths({ spec }: { spec: SceneSpec }) {
  const radii = [...new Set(spec.objects.filter((o) => o.motion === "orbit").map((o) => `${(o.orbitRadius || Math.hypot(o.position[0], o.position[2]) || 2).toFixed(2)}|${o.position[1].toFixed(2)}`))];
  return (
    <>
      {radii.map((key) => {
        const [r, y] = key.split("|").map(Number);
        return (
          <mesh key={key} position={[0, y ?? 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[(r ?? 2) - 0.012, (r ?? 2) + 0.012, 160]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.16} side={THREE.DoubleSide} toneMapped={false} />
          </mesh>
        );
      })}
    </>
  );
}

/** Camera flies in on first show, then the view drifts slowly until you take over. */
function Rig({ r, orbiting }: { r: number; orbiting: boolean }) {
  const { camera } = useThree();
  const start = useRef<number | null>(null);
  const target = useMemo(() => new THREE.Vector3(r * 0.78, r * 0.52, r * 0.95), [r]);
  useFrame(({ clock }) => {
    if (start.current === null) start.current = clock.elapsedTime;
    const t = Math.min(1, (clock.elapsedTime - start.current) / 2.2);
    if (t >= 1 || orbiting) return;
    const e = 1 - (1 - t) ** 3;
    const from = target.clone().multiplyScalar(2.3).add(new THREE.Vector3(-r * 1.2, r * 0.9, 0));
    camera.position.lerpVectors(from, target, e);
    camera.lookAt(0, 0, 0);
  });
  return null;
}

function Backdrop({ kind, r }: { kind: Backdrop; r: number }) {
  if (kind === "space") {
    return (
      <>
        <color attach="background" args={["#02030a"]} />
        <Stars radius={r * 7} depth={r * 3} count={5000} factor={4} saturation={0.4} fade speed={0.4} />
        <Sparkles count={60} scale={r * 3} size={2} speed={0.2} opacity={0.4} color="#9fb7ff" />
        <ambientLight intensity={0.22} />
        <directionalLight position={[r * 2, r, r]} intensity={0.6} color="#cfd8ff" />
      </>
    );
  }
  if (kind === "night") {
    return (
      <>
        <color attach="background" args={["#060a18"]} />
        <fog attach="fog" args={["#060a18", r * 2.2, r * 6]} />
        <Stars radius={r * 8} depth={r * 2} count={2500} factor={3} fade speed={0.3} />
        <hemisphereLight args={["#3a4a80", "#0b0e18", 0.35]} />
        <directionalLight position={[-r, r * 2, r]} intensity={0.55} color="#9db4ff" castShadow shadow-mapSize={[1024, 1024]} />
      </>
    );
  }
  if (kind === "sky" || kind === "sunset") {
    const sunset = kind === "sunset";
    const sun: [number, number, number] = sunset ? [100, 4, -60] : [80, 60, 40];
    return (
      <>
        <Sky distance={4500} sunPosition={sun} turbidity={sunset ? 9 : 4} rayleigh={sunset ? 3 : 1.2} mieCoefficient={0.006} mieDirectionalG={0.85} />
        <fog attach="fog" args={[sunset ? "#f0a37a" : "#cfe3ff", r * 2.5, r * 7]} />
        <hemisphereLight args={[sunset ? "#ffcfa0" : "#d9ecff", sunset ? "#4a2f3a" : "#5a6b50", sunset ? 0.55 : 0.75]} />
        <directionalLight position={[sun[0] / 10, Math.max(2, sun[1] / 8), sun[2] / 10]} intensity={sunset ? 2.2 : 2.6} color={sunset ? "#ffb07a" : "#fff6e8"} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-r * 1.5} shadow-camera-right={r * 1.5} shadow-camera-top={r * 1.5} shadow-camera-bottom={-r * 1.5} />
      </>
    );
  }
  return (
    <>
      <color attach="background" args={["#14171f"]} />
      <ambientLight intensity={0.35} />
      <spotLight position={[r * 1.5, r * 2.5, r * 1.5]} angle={0.5} penumbra={0.8} intensity={60} castShadow shadow-mapSize={[2048, 2048]} />
      <directionalLight position={[-r, r, -r]} intensity={0.6} color="#9fb4ff" />
    </>
  );
}

export function SceneView({ spec, orbiting }: { spec: SceneSpec; orbiting: boolean }) {
  const r = sceneRadius(spec);
  const night = spec.backdrop === "night" || spec.backdrop === "space";
  const hasGround = spec.objects.some((o) => o.shape === "plane");
  const floor = Math.min(...spec.objects.map((o) => o.position[1] - (o.shape === "planet" || o.shape === "sphere" ? o.size[0] : o.size[1]) / 2));
  const glowing = spec.objects.some((o) => o.glow) || night;
  return (
    <Canvas shadows dpr={[1, 1.5]} gl={{ antialias: true }} camera={{ position: [r * 0.78, r * 0.52, r * 0.95], fov: 42, near: 0.05, far: 800 }}>
      <Backdrop kind={spec.backdrop} r={r} />
      {/* Reflections for metal and glass, from soft light panels (no download needed). */}
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.5} position={[0, 5, -6]} scale={[10, 4, 1]} />
        <Lightformer form="rect" intensity={1.2} position={[-6, 2, 2]} rotation-y={Math.PI / 2} scale={[8, 3, 1]} color="#9fc2ff" />
        <Lightformer form="ring" intensity={1.6} position={[5, 3, 4]} scale={3} color="#ffd9b0" />
      </Environment>
      {spec.objects.map((o, i) => (
        <Thing key={i} o={o} index={i} night={night} />
      ))}
      <OrbitPaths spec={spec} />
      {!hasGround && spec.backdrop !== "space" && <ContactShadows position={[0, floor - 0.01, 0]} opacity={0.55} scale={r * 3} blur={2.4} far={r} />}
      <Rig r={r} orbiting={orbiting} />
      <OrbitControls enabled={orbiting} autoRotate={!orbiting} autoRotateSpeed={0.45} enablePan={false} enableDamping minDistance={r * 0.3} maxDistance={r * 5} />
      <Effects glow={glowing} />
    </Canvas>
  );
}

function Effects({ glow }: { glow: boolean }): ReactNode {
  return (
    <EffectComposer multisampling={0}>
      <Bloom mipmapBlur intensity={glow ? 1.1 : 0.45} luminanceThreshold={glow ? 0.55 : 0.85} luminanceSmoothing={0.25} />
      <Vignette eskil={false} offset={0.25} darkness={0.55} />
    </EffectComposer>
  );
}

/** Keep a DOM box glued to a shape's screen rectangle (pan, zoom, move, resize). */
function useScreenRect(editor: Editor, id: string): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const el = ref.current;
      const s = editor.renderer.lookup(id);
      if (!el || !s) return;
      const a = editor.renderer.worldToScreen({ x: s.x, y: s.y });
      const z = editor.renderer.viewport.zoom;
      el.style.transform = `translate(${a.x}px, ${a.y}px)`;
      el.style.width = `${Math.max(10, s.w * z)}px`;
      el.style.height = `${Math.max(10, s.h * z)}px`;
      el.style.borderRadius = `${18 * z}px`;
      el.style.opacity = z < 0.12 ? "0" : "1";
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [editor, id]);
  return ref;
}

function LiveScene({ editor, shape, orbiting }: { editor: Editor; shape: ShapeView; orbiting: boolean }) {
  const ref = useScreenRect(editor, shape.id);
  const spec = useMemo(() => parseScene(shape.data), [shape.data]);
  if (!spec) return null;
  return (
    <div
      ref={ref}
      className={`absolute left-0 top-0 overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.35)] ${orbiting ? "pointer-events-auto ring-2 ring-accent" : "pointer-events-none"}`}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <SceneView spec={spec} orbiting={orbiting} />
      {/* Title bar over the scene. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/55 to-transparent px-4 pb-6 pt-3">
        <span className="truncate text-[13px] font-bold text-white drop-shadow">{spec.title || shape.label || "3D scene"}</span>
        {!orbiting && <span className="shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-white/85 backdrop-blur">3D · double-click to explore</span>}
      </div>
      {orbiting && (
        <button type="button" onClick={() => useUiStore.getState().setOrbiting(undefined)} className="absolute right-3 top-3 rounded-lg bg-black/60 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur">
          Done (Esc)
        </button>
      )}
    </div>
  );
}

/**
 * Live 3D for every 3D scene on screen (at most four at once: each is a WebGL context).
 * They float over their card on the canvas and follow it; double-click one to orbit.
 */
export function Scenes3D({ editor }: { editor: Editor | null }) {
  const version = useSceneVersion(editor, 300);
  const orbiting = useUiStore((s) => s.orbiting);
  const [, setTick] = useState(0);
  // Re-check visibility as the camera moves.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") useUiStore.getState().setOrbiting(undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!editor) return null;
  void version;
  const view = editor.renderer.visibleWorld;
  const live = editor.scene
    .ordered()
    .filter((s) => s.kind === "scene3d" && s.x < view.x + view.w && s.x + s.w > view.x && s.y < view.y + view.h && s.y + s.h > view.y)
    .slice(-MAX_LIVE);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {live.map((s) => (
        <LiveScene key={s.id} editor={editor} shape={s} orbiting={orbiting === s.id} />
      ))}
    </div>
  );
}
