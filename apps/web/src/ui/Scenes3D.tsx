import type { ShapeView } from "@canvas/doc";
import { Html, OrbitControls, Stars } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import type * as THREE from "three";
import type { Editor } from "../canvas/editor";
import { parseScene, sceneRadius, type SceneObject, type SceneSpec } from "../canvas/scenes";
import { useUiStore } from "../state/ui-store";
import { useSceneVersion } from "./useScene";

const MAX_LIVE = 4;

function Thing({ o, index }: { o: SceneObject; index: number }) {
  const ref = useRef<THREE.Group>(null);
  const [sx, sy, sz] = o.size;
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const t = clock.elapsedTime * o.speed;
    const [x, y, z] = o.position;
    g.position.set(x, y, z);
    g.rotation.set(o.rotation[0], o.rotation[1], o.rotation[2]);
    if (o.motion === "spin") g.rotation.y = o.rotation[1] + t;
    if (o.motion === "bob") g.position.y = y + Math.sin(t * 2 + index) * 0.25;
    if (o.motion === "pulse") g.scale.setScalar(1 + Math.sin(t * 3 + index) * 0.08);
    if (o.motion === "orbit") {
      const r = o.orbitRadius || Math.hypot(x, z) || 2;
      const a = t * 0.6 + index;
      g.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      g.rotation.y = t;
    }
  });
  const material = <meshStandardMaterial color={o.color} roughness={0.45} metalness={0.15} emissive={o.glow ? o.color : "#000000"} emissiveIntensity={o.glow ? 1.4 : 0} />;
  return (
    <group ref={ref}>
      {o.shape === "box" && (
        <mesh castShadow receiveShadow>
          <boxGeometry args={[sx, sy, sz]} />
          {material}
        </mesh>
      )}
      {o.shape === "sphere" && (
        <mesh castShadow>
          <sphereGeometry args={[sx / 2, 40, 40]} />
          {material}
        </mesh>
      )}
      {o.shape === "cylinder" && (
        <mesh castShadow>
          <cylinderGeometry args={[sx / 2, sx / 2, sy, 36]} />
          {material}
        </mesh>
      )}
      {o.shape === "cone" && (
        <mesh castShadow>
          <coneGeometry args={[sx / 2, sy, 36]} />
          {material}
        </mesh>
      )}
      {o.shape === "torus" && (
        <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[sx / 2, Math.max(0.04, sy / 6), 20, 64]} />
          {material}
        </mesh>
      )}
      {o.shape === "ring" && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[sx / 2 - Math.max(0.03, sy / 10), sx / 2, 96]} />
          <meshBasicMaterial color={o.color} side={2} transparent opacity={0.6} />
        </mesh>
      )}
      {o.shape === "plane" && (
        <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[sx, sz]} />
          {material}
        </mesh>
      )}
      {o.label && (
        <Html position={[0, Math.max(sy, o.shape === "sphere" ? sx : 0) / 2 + 0.35, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
          <span className="whitespace-nowrap rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">{o.label}</span>
        </Html>
      )}
    </group>
  );
}

function SceneView({ spec, orbiting }: { spec: SceneSpec; orbiting: boolean }) {
  const r = sceneRadius(spec);
  const bg = spec.backdrop === "space" ? "#05060a" : spec.backdrop === "sky" ? "#bcd8ff" : "#14171f";
  return (
    <Canvas shadows dpr={[1, 1.75]} camera={{ position: [r * 0.95, r * 0.7, r * 1.1], fov: 45, near: 0.1, far: 400 }} onCreated={({ gl }) => gl.setClearColor(bg)}>
      <ambientLight intensity={spec.backdrop === "space" ? 0.25 : 0.7} />
      <directionalLight position={[r, r * 2, r]} intensity={1.4} castShadow />
      {spec.backdrop === "space" && <Stars radius={r * 6} depth={r * 3} count={2500} factor={3} fade speed={0.6} />}
      {spec.objects.some((o) => o.glow) && <pointLight position={[0, 0, 0]} intensity={30} distance={r * 3} color="#ffd9a0" />}
      {spec.objects.map((o, i) => (
        <Thing key={i} o={o} index={i} />
      ))}
      <OrbitControls enabled={orbiting} autoRotate={!orbiting} autoRotateSpeed={0.6} enablePan={false} />
    </Canvas>
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
      // Inside the card, under its title row and above its footer.
      el.style.transform = `translate(${a.x + 6 * z}px, ${a.y + 46 * z}px)`;
      el.style.width = `${Math.max(10, (s.w - 12) * z)}px`;
      el.style.height = `${Math.max(10, (s.h - 78) * z)}px`;
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
      className={`absolute left-0 top-0 overflow-hidden rounded-xl ${orbiting ? "pointer-events-auto ring-2 ring-accent" : "pointer-events-none"}`}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <SceneView spec={spec} orbiting={orbiting} />
      {orbiting && (
        <button type="button" onClick={() => useUiStore.getState().setOrbiting(undefined)} className="absolute right-2 top-2 rounded-lg bg-black/60 px-2 py-1 text-[11px] font-bold text-white backdrop-blur">
          Done orbiting (Esc)
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
