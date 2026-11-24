import type { ShapeView } from "@canvas/doc";
import { ContactShadows, Environment, Html, Lightformer, OrbitControls, Sky, Sparkles, Stars, useGLTF } from "@react-three/drei";
import { createXRStore, XR, type XRStore } from "@react-three/xr";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { Component, createContext, Suspense, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import type { Editor } from "../canvas/editor";
import { parseScene, sceneRadius, type Backdrop, type Material, type Motion, type SceneObject, type SceneSpec } from "../canvas/scenes";
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
    case "model":
      return (
        <ModelBoundary size={o.size}>
          <Suspense fallback={<LoadingBox size={o.size} />}>
            <Gltf url={o.url} size={o.size} />
          </Suspense>
        </ModelBoundary>
      );
    default:
      return null;
  }
}

/** A real 3D model from a .glb/.gltf link, scaled into the object's box and stood on its base. */
function Gltf({ url, size }: { url: string; size: readonly [number, number, number] }) {
  const gltf = useGLTF(url);
  const fitted = useMemo(() => {
    const copy = gltf.scene.clone(true);
    copy.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    const box = new THREE.Box3().setFromObject(copy);
    const dims = box.getSize(new THREE.Vector3());
    const k = Math.min(size[0] / Math.max(dims.x, 1e-3), size[1] / Math.max(dims.y, 1e-3), size[2] / Math.max(dims.z, 1e-3));
    const center = box.getCenter(new THREE.Vector3());
    // Centred sideways, standing on the bottom of its box.
    copy.position.set(-center.x * k, -box.min.y * k - size[1] / 2, -center.z * k);
    copy.scale.setScalar(k);
    const holder = new THREE.Group();
    holder.add(copy);
    return holder;
  }, [gltf, size[0], size[1], size[2]]);
  return <primitive object={fitted} />;
}

function LoadingBox({ size }: { size: readonly [number, number, number] }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.elapsedTime * 1.5;
  });
  return (
    <mesh ref={ref}>
      <boxGeometry args={[size[0] * 0.6, size[1] * 0.6, size[2] * 0.6]} />
      <meshStandardMaterial color="#5b8cff" wireframe />
    </mesh>
  );
}

/** A model that fails to load (bad link, no CORS) shows a red box instead of breaking the scene. */
class ModelBoundary extends Component<{ size: readonly [number, number, number]; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const [w, h, d] = this.props.size;
    return (
      <mesh>
        <boxGeometry args={[w * 0.6, h * 0.6, d * 0.6]} />
        <meshStandardMaterial color="#ff5c5c" wireframe />
      </mesh>
    );
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

// --- motion, selection & exploring ---------------------------------------------------

interface ExploreState {
  /** The scene is being explored (orbit, select, drag). */
  readonly on: boolean;
  readonly selected: number | undefined;
  select(index: number | undefined): void;
  /** Object being dragged, or undefined. */
  readonly dragging: number | undefined;
  startDrag(index: number): void;
  /** Drag finished: the new ground position. */
  endDrag(index: number, x: number, z: number): void;
}

const NO_EXPLORE: ExploreState = { on: false, selected: undefined, select: () => {}, dragging: undefined, startDrag: () => {}, endDrag: () => {} };
const ExploreCtx = createContext<ExploreState>(NO_EXPLORE);

/** Scene time: stops when paused, so everything freezes in place and resumes smoothly. */
interface Clock {
  t: number;
}
const ClockCtx = createContext<{ current: Clock; paused: boolean }>({ current: { t: 0 }, paused: false });

function Ticker({ clock, paused }: { clock: Clock; paused: boolean }) {
  useFrame((_, dt) => {
    if (!paused) clock.t += Math.min(dt, 0.1);
  });
  return null;
}

/** Live positions of objects being dragged, and the groups (for selection boxes and focus). */
interface Live {
  readonly overrides: Map<number, [number, number]>;
  readonly groups: Map<number, THREE.Group>;
}
const LiveCtx = createContext<Live>({ overrides: new Map(), groups: new Map() });

function Thing({ o, index, night }: { o: SceneObject; index: number; night: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const explore = useContext(ExploreCtx);
  const { current: clock } = useContext(ClockCtx);
  const live = useContext(LiveCtx);
  useEffect(() => {
    const g = ref.current;
    if (g) live.groups.set(index, g);
    return () => void live.groups.delete(index);
  }, [index, live]);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const t = clock.t * o.speed;
    const drag = live.overrides.get(index);
    const [x0, y, z0] = o.position;
    const x = drag ? drag[0] : x0;
    const z = drag ? drag[1] : z0;
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
    if (o.motion === "orbit" && !drag) {
      const r = o.orbitRadius || Math.hypot(x, z) || 2;
      const a = t * (0.9 / Math.sqrt(Math.max(0.5, r))) + index * 2.4;
      g.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      g.rotation.y = t * 0.8;
    }
  });
  const [sx, sy] = o.size;
  const top = o.shape === "planet" || o.shape === "sphere" ? sx / 2 : Math.max(sy, 0.1) / 2;
  const pickable = explore.on && o.shape !== "plane";
  const selected = explore.selected === index;
  return (
    <group
      ref={ref}
      onClick={(e) => {
        if (!pickable) return;
        e.stopPropagation();
        explore.select(index);
      }}
      onPointerDown={(e) => {
        // Press on the selected object and drag: move it along the ground.
        if (!pickable || !selected) return;
        e.stopPropagation();
        explore.startDrag(index);
      }}
      onPointerOver={() => {
        if (pickable) document.body.style.cursor = selected ? "grab" : "pointer";
      }}
      onPointerOut={() => {
        if (pickable) document.body.style.cursor = "";
      }}
    >
      <Model o={o} index={index} night={night} />
      {o.glow && <pointLight intensity={Math.min(60, 8 + sx * 10)} distance={Math.max(6, sx * 8)} color={o.color} decay={1.6} />}
      {o.label && (
        <Html position={[0, top + 0.4, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
          <span className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg backdrop-blur-md transition-all ${selected ? "scale-110 border-[#5b8cff] bg-[#5b8cff]/70" : "border-white/15 bg-black/55"}`}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: o.color }} />
            {o.label}
          </span>
        </Html>
      )}
    </group>
  );
}

/** A glowing box and ground ring around the selected object; follows it as it moves. */
function SelectionMarker({ spec }: { spec: SceneSpec }) {
  const explore = useContext(ExploreCtx);
  const live = useContext(LiveCtx);
  const box = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const bounds = useMemo(() => new THREE.Box3(), []);
  const size = useMemo(() => new THREE.Vector3(), []);
  const center = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }) => {
    const g = explore.selected === undefined ? undefined : live.groups.get(explore.selected);
    const b = box.current;
    const r = ring.current;
    if (!b || !r) return;
    b.visible = r.visible = Boolean(g);
    if (!g) return;
    const o = explore.selected === undefined ? undefined : spec.objects[explore.selected];
    b.visible = o?.shape !== "planet" && o?.shape !== "sphere";
    bounds.setFromObject(g, true);
    if (bounds.isEmpty()) return;
    bounds.getSize(size);
    bounds.getCenter(center);
    b.position.copy(center);
    b.scale.set(size.x + 0.15, size.y + 0.15, size.z + 0.15);
    r.position.set(center.x, bounds.min.y + 0.02, center.z);
    const pulse = 1 + Math.sin(clock.elapsedTime * 4) * 0.06;
    const rr = Math.max(size.x, size.z) * 0.75 + 0.3;
    r.scale.set(rr * pulse, rr * pulse, 1);
  });
  return (
    <>
      <mesh ref={box} visible={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#5b8cff" wireframe transparent opacity={0.85} toneMapped={false} />
      </mesh>
      <mesh ref={ring} visible={false} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.92, 1, 64]} />
        <meshBasicMaterial color="#5b8cff" transparent opacity={0.9} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    </>
  );
}

/** While dragging: an invisible floor at the object's height that follows the pointer. */
function DragFloor({ spec, r }: { spec: SceneSpec; r: number }) {
  const explore = useContext(ExploreCtx);
  const live = useContext(LiveCtx);
  const index = explore.dragging;
  const o = index === undefined ? undefined : spec.objects[index];
  if (index === undefined || !o) return null;
  const finish = (): void => {
    const p = live.overrides.get(index);
    document.body.style.cursor = "";
    if (p) explore.endDrag(index, p[0], p[1]);
    else explore.endDrag(index, o.position[0], o.position[2]);
  };
  return (
    <mesh
      position={[0, o.position[1], 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerMove={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "grabbing";
        const lim = r * 1.6;
        live.overrides.set(index, [Math.max(-lim, Math.min(lim, e.point.x)), Math.max(-lim, Math.min(lim, e.point.z))]);
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        finish();
      }}
      onPointerLeave={finish}
    >
      <planeGeometry args={[r * 40, r * 40]} />
      <meshBasicMaterial visible={false} />
    </mesh>
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

/**
 * The camera: flies in on first show; then either drifts (on the board) or follows the
 * explorer — flying to a selected object, and back home on "reset view".
 */
function Rig({ r, explore, reset }: { r: number; explore: ExploreState; reset: number }) {
  const { camera, controls } = useThree();
  const live = useContext(LiveCtx);
  const start = useRef<number | null>(null);
  const home = useMemo(() => new THREE.Vector3(r * 0.78, r * 0.52, r * 0.95), [r]);
  const fly = useRef<{ from: THREE.Vector3; to: THREE.Vector3; fromT: THREE.Vector3; toT: THREE.Vector3; at: number } | null>(null);
  const now = useRef(0);
  const target = (): THREE.Vector3 | undefined => (controls as unknown as { target?: THREE.Vector3 } | null)?.target;
  // Selecting an object flies the camera to it.
  useEffect(() => {
    const g = explore.selected === undefined ? undefined : live.groups.get(explore.selected);
    const t = target();
    if (!g || !t) return;
    const box = new THREE.Box3().setFromObject(g, true);
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const dir = camera.position.clone().sub(t).normalize();
    fly.current = { from: camera.position.clone(), to: c.clone().add(dir.multiplyScalar(Math.max(size * 2.2, 2.5))), fromT: t.clone(), toT: c, at: now.current };
  }, [explore.selected]);
  useEffect(() => {
    const t = target();
    if (reset === 0 || !t) return;
    fly.current = { from: camera.position.clone(), to: home.clone(), fromT: t.clone(), toT: new THREE.Vector3(), at: now.current };
  }, [reset]);
  useFrame(({ clock }) => {
    now.current = clock.elapsedTime;
    if (start.current === null) start.current = clock.elapsedTime;
    const intro = Math.min(1, (clock.elapsedTime - start.current) / 2.2);
    if (intro < 1 && !explore.on) {
      const e = 1 - (1 - intro) ** 3;
      const from = home.clone().multiplyScalar(2.3).add(new THREE.Vector3(-r * 1.2, r * 0.9, 0));
      camera.position.lerpVectors(from, home, e);
      camera.lookAt(0, 0, 0);
      return;
    }
    const f = fly.current;
    const t = target();
    if (!f || !t) return;
    const k = Math.min(1, (clock.elapsedTime - f.at) / 0.8);
    const e = 1 - (1 - k) ** 3;
    camera.position.lerpVectors(f.from, f.to, e);
    t.lerpVectors(f.fromT, f.toT, e);
    if (k >= 1) fly.current = null;
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

export interface SceneViewProps {
  readonly spec: SceneSpec;
  /** Exploring: orbit/zoom/pan, select, drag. Off on the board and the homepage. */
  readonly orbiting: boolean;
  readonly explore?: ExploreState;
  readonly paused?: boolean;
  readonly autoRotate?: boolean;
  /** Bump to fly the camera back home. */
  readonly reset?: number;
  /** VR/AR: the session store (only while exploring). */
  readonly xr?: XRStore;
}

export function SceneView({ spec, orbiting, explore = NO_EXPLORE, paused = false, autoRotate, reset = 0, xr }: SceneViewProps) {
  const r = sceneRadius(spec);
  const night = spec.backdrop === "night" || spec.backdrop === "space";
  const hasGround = spec.objects.some((o) => o.shape === "plane");
  const floor = Math.min(...spec.objects.map((o) => o.position[1] - (o.shape === "planet" || o.shape === "sphere" ? o.size[0] : o.size[1]) / 2));
  const glowing = spec.objects.some((o) => o.glow) || night;
  const clock = useRef<Clock>({ t: 0 }).current;
  const live = useMemo<Live>(() => ({ overrides: new Map(), groups: new Map() }), []);
  // A finished drag is saved into the spec; drop the live override once it's there.
  useEffect(() => {
    live.overrides.clear();
  }, [spec, live]);
  const rotate = autoRotate ?? !orbiting;
  return (
    // The canvas only takes pointer events while exploring: otherwise clicks go through to
    // the board (to select, move, or double-click to explore).
    <Canvas
      shadows
      dpr={[1, 1.5]}
      gl={{ antialias: true }}
      style={{ pointerEvents: orbiting ? "auto" : "none", touchAction: "none" }}
      camera={{ position: [r * 0.78, r * 0.52, r * 0.95], fov: 42, near: 0.05, far: 800 }}
      onPointerMissed={() => explore.select(undefined)}
    >
      <XrMaybe store={xr}>
      <ExploreCtx.Provider value={explore}>
        <ClockCtx.Provider value={{ current: clock, paused }}>
          <LiveCtx.Provider value={live}>
            <Ticker clock={clock} paused={paused} />
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
            <SelectionMarker spec={spec} />
            <DragFloor spec={spec} r={r} />
            {!hasGround && spec.backdrop !== "space" && <ContactShadows position={[0, floor - 0.01, 0]} opacity={0.55} scale={r * 3} blur={2.4} far={r} />}
            <Rig r={r} explore={explore} reset={reset} />
            <OrbitControls makeDefault enabled={orbiting && explore.dragging === undefined} autoRotate={rotate} autoRotateSpeed={0.45} enablePan={orbiting} enableDamping minDistance={r * 0.15} maxDistance={r * 6} />
            <Effects glow={glowing} />
          </LiveCtx.Provider>
        </ClockCtx.Provider>
      </ExploreCtx.Provider>
      </XrMaybe>
    </Canvas>
  );
}

function XrMaybe({ store, children }: { store: XRStore | undefined; children: ReactNode }): ReactNode {
  return store ? <XR store={store}>{children}</XR> : children;
}

/** Whether this browser/device can open an immersive session ("immersive-vr" or "immersive-ar"). */
function useXrSupport(): { vr: boolean; ar: boolean } {
  const [support, setSupport] = useState({ vr: false, ar: false });
  useEffect(() => {
    const xr = (navigator as Navigator & { xr?: { isSessionSupported(mode: string): Promise<boolean> } }).xr;
    if (!xr) return;
    void Promise.all([xr.isSessionSupported("immersive-vr").catch(() => false), xr.isSessionSupported("immersive-ar").catch(() => false)]).then(([vr, ar]) => setSupport({ vr, ar }));
  }, []);
  return support;
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
function useScreenRect(editor: Editor, id: string, fullscreen: React.RefObject<boolean>): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const el = ref.current;
      const s = editor.renderer.lookup(id);
      if (!el || !s) return;
      if (fullscreen.current) {
        el.style.transform = "none";
        el.style.width = "100vw";
        el.style.height = "100vh";
        el.style.borderRadius = "0";
        el.style.opacity = "1";
        return;
      }
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

const SWATCHES = ["#ff5a5a", "#ff8a3d", "#ffd24a", "#3fcf7a", "#19c3a5", "#3d7bff", "#8b6cff", "#ff5fa2", "#f2f2f2", "#1d2029"];
const MOTIONS: readonly Motion[] = ["none", "spin", "orbit", "bob", "float", "pulse"];
const ADDABLE: ReadonlyArray<{ shape: string; label: string; icon: string; size: [number, number, number]; color: string; extra?: Record<string, unknown> }> = [
  { shape: "planet", label: "Planet", icon: "🪐", size: [1, 1, 1], color: "#3d7bff" },
  { shape: "tree", label: "Tree", icon: "🌳", size: [1.2, 1.4, 1.2], color: "#3f8f4a" },
  { shape: "pine", label: "Pine", icon: "🌲", size: [1, 1.6, 1], color: "#2a7a46" },
  { shape: "building", label: "Building", icon: "🏢", size: [1.6, 4, 1.6], color: "#2b3a55" },
  { shape: "house", label: "House", icon: "🏠", size: [1.6, 1.3, 1.4], color: "#c98d5a" },
  { shape: "rocket", label: "Rocket", icon: "🚀", size: [0.8, 2, 0.8], color: "#ff5a5a", extra: { motion: "float" } },
  { shape: "car", label: "Car", icon: "🚗", size: [1, 0.6, 0.6], color: "#ffc53d" },
  { shape: "person", label: "Person", icon: "🧍", size: [0.5, 1, 0.5], color: "#3d7bff" },
  { shape: "cloud", label: "Cloud", icon: "☁️", size: [2.4, 1.1, 1.4], color: "#e9eef7", extra: { motion: "float", speed: 0.3 } },
  { shape: "mountain", label: "Mountain", icon: "⛰️", size: [4, 3, 4], color: "#7b6a62" },
  { shape: "server", label: "Server", icon: "🖥️", size: [1, 1.8, 0.8], color: "#3b4252" },
  { shape: "crystal", label: "Crystal", icon: "💎", size: [0.9, 1.3, 0.9], color: "#7a6bff", extra: { glow: true, motion: "spin" } },
];

/** The scene as plain JSON (what the shape stores), with one object changed. */
function serialize(spec: SceneSpec, objects: readonly SceneObject[]): string {
  return JSON.stringify({ title: spec.title, backdrop: spec.backdrop, objects });
}

function ToolButton({ children, onClick, title, active }: { children: ReactNode; onClick: () => void; title: string; active?: boolean }) {
  return (
    <button type="button" title={title} onClick={onClick} className={`flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-[12px] font-bold text-white backdrop-blur-md transition-colors ${active ? "bg-[#5b8cff]" : "bg-black/55 hover:bg-black/75"}`}>
      {children}
    </button>
  );
}

/**
 * One 3D scene on the board. On the canvas it's a live picture glued to its card; explore it
 * (double-click, or the Explore button) to orbit, zoom and pan, click objects to fly to
 * them, drag them around, recolor, resize, animate, add or delete — saved to the board for
 * everyone. Fullscreen fills the window (and is the default on phones).
 */
function LiveScene({ editor, shape, orbiting }: { editor: Editor; shape: ShapeView; orbiting: boolean }) {
  const fullRef = useRef(false);
  const ref = useScreenRect(editor, shape.id, fullRef);
  const spec = useMemo(() => parseScene(shape.data), [shape.data]);
  const [selected, setSelected] = useState<number | undefined>(undefined);
  const [dragging, setDragging] = useState<number | undefined>(undefined);
  const [paused, setPaused] = useState(false);
  const [spin, setSpin] = useState(false);
  const [reset, setReset] = useState(0);
  const [full, setFull] = useState(false);
  const [adding, setAdding] = useState(false);
  const [modelUrl, setModelUrl] = useState("");
  const xrSupport = useXrSupport();
  const xrStore = useMemo(() => (xrSupport.vr || xrSupport.ar ? createXRStore({ emulate: false }) : undefined), [xrSupport.vr, xrSupport.ar]);
  const exit = (): void => {
    useUiStore.getState().setOrbiting(undefined);
    setSelected(undefined);
    setFull(false);
    setAdding(false);
  };
  // Phones explore fullscreen: the card is too small to touch.
  useEffect(() => {
    if (orbiting && window.innerWidth < 768) setFull(true);
    if (!orbiting) {
      setSelected(undefined);
      setFull(false);
    }
  }, [orbiting]);

  const save = (objects: readonly SceneObject[]): void => {
    if (!spec) return;
    editor.updateShapes([{ id: shape.id, patch: { data: serialize(spec, objects) } }], editor.beginGroup());
  };
  const patchSelected = (patch: Partial<SceneObject>): void => {
    if (!spec || selected === undefined) return;
    save(spec.objects.map((o, i) => (i === selected ? { ...o, ...patch } : o)));
  };

  // Keys while exploring: Esc steps out, Delete removes the selected object (not the card).
  useEffect(() => {
    if (!orbiting) return;
    const onKey = (e: KeyboardEvent): void => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        if (selected !== undefined) setSelected(undefined);
        else exit();
      } else if ((e.key === "Delete" || e.key === "Backspace") && !typing) {
        e.stopImmediatePropagation();
        e.preventDefault();
        if (spec && selected !== undefined) {
          save(spec.objects.filter((_, i) => i !== selected));
          setSelected(undefined);
        }
      } else if (e.key === " " && !typing) {
        e.stopImmediatePropagation();
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [orbiting, selected, spec]);

  if (!spec) return null;
  const explore: ExploreState = {
    on: orbiting,
    selected,
    select: (i) => {
      setSelected(i);
      setAdding(false);
    },
    dragging,
    startDrag: (i) => setDragging(i),
    endDrag: (i, x, z) => {
      setDragging(undefined);
      const o = spec.objects[i];
      if (!o) return;
      const moved = Math.hypot(o.position[0] - x, o.position[2] - z) > 0.01;
      if (!moved) return;
      // Orbiting things keep circling: dragging sets how far out.
      save(spec.objects.map((obj, k) => (k === i ? (obj.motion === "orbit" ? { ...obj, orbitRadius: Math.max(0.5, Math.hypot(x, z)), position: [x, obj.position[1], z] } : { ...obj, position: [x, obj.position[1], z] }) : obj)));
    },
  };
  const sel = selected === undefined ? undefined : spec.objects[selected];

  const ui = (
    <>
      <SceneView spec={spec} orbiting={orbiting} explore={explore} paused={paused} autoRotate={orbiting ? spin : true} reset={reset} {...(orbiting && xrStore ? { xr: xrStore } : {})} />
      {/* Title bar over the scene. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent px-3 pb-8 pt-3">
        <span className="truncate pt-1.5 text-[13px] font-bold text-white drop-shadow">{spec.title || shape.label || "3D scene"}</span>
        {orbiting ? (
          <div className="pointer-events-auto flex flex-wrap justify-end gap-1.5">
            <ToolButton title={paused ? "Play (Space)" : "Pause (Space)"} onClick={() => setPaused(!paused)}>
              {paused ? "▶" : "❚❚"}
            </ToolButton>
            <ToolButton title="Spin the view" active={spin} onClick={() => setSpin(!spin)}>
              ⟳
            </ToolButton>
            <ToolButton title="Reset view" onClick={() => setReset((n) => n + 1)}>
              ⌂
            </ToolButton>
            <ToolButton title="Add an object" active={adding} onClick={() => setAdding(!adding)}>
              ＋ Add
            </ToolButton>
            {xrStore && xrSupport.vr && (
              <ToolButton title="View in VR (headset)" onClick={() => void xrStore.enterVR()}>
                🥽 VR
              </ToolButton>
            )}
            {xrStore && xrSupport.ar && (
              <ToolButton title="Place it in your room (AR)" onClick={() => void xrStore.enterAR()}>
                📱 AR
              </ToolButton>
            )}
            <ToolButton title={full ? "Exit fullscreen" : "Fullscreen"} onClick={() => setFull(!full)}>
              {full ? "⤡" : "⤢"}
            </ToolButton>
            <ToolButton title="Done (Esc)" onClick={exit}>
              Done
            </ToolButton>
          </div>
        ) : (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => useUiStore.getState().setOrbiting(shape.id)}
            className="pointer-events-auto shrink-0 rounded-full bg-white/90 px-3 py-1 text-[11px] font-bold text-[#0b0d14] shadow-lg backdrop-blur transition-transform hover:scale-105"
          >
            ✦ Explore in 3D
          </button>
        )}
      </div>

      {orbiting && adding && (
        <div className="pointer-events-auto absolute right-3 top-14 grid w-[260px] grid-cols-3 gap-1.5 rounded-2xl border border-white/15 bg-black/70 p-2 backdrop-blur-xl">
          {ADDABLE.map((a) => (
            <button
              key={a.shape}
              type="button"
              onClick={() => {
                const angle = Math.random() * Math.PI * 2;
                const d = sceneRadius(spec) * 0.35;
                const next = parseScene(serialize(spec, [...spec.objects, { shape: a.shape, label: a.label, color: a.color, position: [Math.cos(angle) * d, a.size[1] / 2, Math.sin(angle) * d], size: a.size, motion: "none", ...a.extra } as unknown as SceneObject]));
                if (next) {
                  save(next.objects);
                  setSelected(next.objects.length - 1);
                }
                setAdding(false);
              }}
              className="flex flex-col items-center gap-0.5 rounded-xl py-2 text-white hover:bg-white/10"
            >
              <span className="text-[20px]">{a.icon}</span>
              <span className="text-[10px] font-semibold">{a.label}</span>
            </button>
          ))}
          <div className="col-span-3 mt-1 border-t border-white/10 pt-2">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-white/60">Import a 3D model (.glb link)</p>
            <div className="flex gap-1">
              <input
                value={modelUrl}
                onChange={(e) => setModelUrl(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="https://…/model.glb"
                className="min-w-0 flex-1 rounded-lg bg-white/10 px-2 py-1 text-[11px] text-white outline-none placeholder:text-white/40"
              />
              <button
                type="button"
                onClick={() => {
                  const url = modelUrl.trim();
                  const next = parseScene(serialize(spec, [...spec.objects, { shape: "model", label: url.split("/").pop()?.replace(/\.(glb|gltf).*$/i, "") ?? "Model", color: "#ffffff", position: [0, 1, 0], size: [2.5, 2.5, 2.5], motion: "none", url } as unknown as SceneObject]));
                  const added = next && next.objects.length > spec.objects.length;
                  if (next && added) {
                    save(next.objects);
                    setSelected(next.objects.length - 1);
                    setModelUrl("");
                    setAdding(false);
                  } else useUiStore.getState().setNotice("Use an https link ending in .glb or .gltf");
                }}
                className="shrink-0 rounded-lg bg-[#5b8cff] px-2 text-[11px] font-bold text-white"
              >
                Add
              </button>
            </div>
            <button type="button" onClick={() => setModelUrl("https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Duck/glTF-Binary/Duck.glb")} className="mt-1 text-[10px] font-semibold text-[#9fc2ff] hover:underline">
              Try a sample (Khronos duck)
            </button>
          </div>
        </div>
      )}

      {orbiting && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3">
          {sel ? (
            <div className="pointer-events-auto w-full max-w-[560px] rounded-2xl border border-white/15 bg-black/70 p-3 text-white shadow-2xl backdrop-blur-xl" onPointerDown={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: sel.color }} />
                <input
                  value={sel.label}
                  placeholder={sel.shape}
                  onChange={(e) => patchSelected({ label: e.target.value.slice(0, 40) })}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="min-w-0 flex-1 rounded-lg bg-white/10 px-2 py-1 text-[13px] font-bold outline-none focus:bg-white/15"
                />
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold capitalize text-white/70">{sel.shape}</span>
                <button type="button" title="Duplicate" onClick={() => {
                  const copy = { ...sel, position: [sel.position[0] + 1.5, sel.position[1], sel.position[2] + 0.8] as const };
                  const next = parseScene(serialize(spec, [...spec.objects, copy]));
                  if (next) {
                    save(next.objects);
                    setSelected(next.objects.length - 1);
                  }
                }} className="rounded-lg px-2 py-1 text-[12px] font-bold hover:bg-white/10">⧉</button>
                <button type="button" title="Delete (Del)" onClick={() => {
                  save(spec.objects.filter((_, i) => i !== selected));
                  setSelected(undefined);
                }} className="rounded-lg px-2 py-1 text-[12px] font-bold text-[#ff8a80] hover:bg-white/10">🗑</button>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {SWATCHES.map((c) => (
                  <button key={c} type="button" title={c} onClick={() => patchSelected({ color: c })} className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${sel.color === c ? "border-white" : "border-white/20"}`} style={{ background: c }} />
                ))}
                <input type="color" value={sel.color} onChange={(e) => patchSelected({ color: e.target.value })} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent" title="Any color" />
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-white/50">Size</span>
                {[0.7, 0.9, 1.15, 1.4].map((k) => (
                  <button key={k} type="button" onClick={() => patchSelected({ size: [sel.size[0] * k, sel.size[1] * k, sel.size[2] * k] })} className="rounded-lg bg-white/10 px-2 py-1 text-[11px] font-bold hover:bg-white/20">
                    {k < 1 ? `−${Math.round((1 - k) * 100)}%` : `+${Math.round((k - 1) * 100)}%`}
                  </button>
                ))}
                <span className="ml-2 mr-1 text-[10px] font-bold uppercase tracking-wider text-white/50">Glow</span>
                <button type="button" onClick={() => patchSelected({ glow: !sel.glow })} className={`rounded-lg px-2 py-1 text-[11px] font-bold ${sel.glow ? "bg-[#ffb547] text-black" : "bg-white/10 hover:bg-white/20"}`}>
                  {sel.glow ? "On" : "Off"}
                </button>
              </div>
              <div className="mt-2.5 grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-white/50">
                  Height
                  <input type="range" min={0} max={8} step={0.25} value={sel.lift} onChange={(e) => patchSelected({ lift: Number(e.target.value) })} className="min-w-0 flex-1 accent-[#5b8cff]" />
                </label>
                <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-white/50">
                  Turn
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    step={5}
                    value={Math.round((sel.rotation[1] * 180) / Math.PI)}
                    onChange={(e) => patchSelected({ rotation: [sel.rotation[0], (Number(e.target.value) * Math.PI) / 180, sel.rotation[2]] })}
                    className="min-w-0 flex-1 accent-[#5b8cff]"
                  />
                </label>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-white/50">Motion</span>
                {MOTIONS.map((m) => (
                  <button key={m} type="button" onClick={() => patchSelected({ motion: m, ...(m === "orbit" ? { orbitRadius: Math.max(1.5, Math.hypot(sel.position[0], sel.position[2])) } : {}) })} className={`rounded-lg px-2 py-1 text-[11px] font-bold capitalize ${sel.motion === m ? "bg-[#5b8cff]" : "bg-white/10 hover:bg-white/20"}`}>
                    {m}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[10.5px] text-white/50">Drag it to move · Del to delete · Esc to deselect</p>
            </div>
          ) : (
            <p className="rounded-full bg-black/60 px-3 py-1.5 text-center text-[11px] font-semibold text-white/85 backdrop-blur">
              {window.matchMedia("(pointer: coarse)").matches ? "Tap an object to fly to it · drag to orbit · pinch to zoom · two fingers to pan" : "Click an object to fly to it · drag to orbit · right-drag to pan · scroll to zoom"}
            </p>
          )}
        </div>
      )}
    </>
  );

  // Fullscreen is the same element pinned to the window (moving the 3D view elsewhere in
  // the page would tear down its labels mid-render).
  fullRef.current = full;
  return (
    <div
      ref={ref}
      className={`${full ? "fixed left-0 top-0 z-[70] bg-black" : "absolute left-0 top-0 shadow-[0_20px_60px_rgba(0,0,0,0.35)]"} overflow-hidden ${orbiting ? "pointer-events-auto" : "pointer-events-none"} ${orbiting && !full ? "ring-2 ring-accent" : ""}`}
      onPointerDown={orbiting ? (e) => e.stopPropagation() : undefined}
      onWheel={orbiting ? (e) => e.stopPropagation() : undefined}
    >
      {ui}
    </div>
  );
}

/**
 * Live 3D for every 3D scene on screen (at most four at once: each is a WebGL context).
 * They float over their card on the canvas and follow it; double-click one to explore.
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
  if (!editor) return null;
  void version;
  const view = editor.renderer.visibleWorld;
  const live = editor.scene
    .ordered()
    .filter((s) => s.kind === "scene3d" && (s.id === orbiting || (s.x < view.x + view.w && s.x + s.w > view.x && s.y < view.y + view.h && s.y + s.h > view.y)))
    .slice(-MAX_LIVE);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {live.map((s) => (
        <LiveScene key={s.id} editor={editor} shape={s} orbiting={orbiting === s.id} />
      ))}
    </div>
  );
}
