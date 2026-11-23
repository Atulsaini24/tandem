import { useEffect, useMemo, useRef, useState } from "react";
import { CHART_THEMES } from "../canvas/charts";
import type { Editor } from "../canvas/editor";
import { designSvg } from "../canvas/export";
import { useUiStore } from "../state/ui-store";

const DURATION = 3200;

/**
 * The build-in animation for designed shapes (charts and slides). The canvas shows them as
 * a still texture; for a few seconds after they appear (or when Present mode lands on
 * them) the same SVG is laid over them live, with its parts animating in: bars grow, lines
 * draw, cards rise. When it ends, the overlay goes and the still picture is identical.
 */
export function Reveal({ editor }: { editor: Editor | null }) {
  const reveals = useUiStore((s) => s.reveals);
  const [now, setNow] = useState(() => Date.now());
  const active = Object.entries(reveals).filter(([, at]) => now - at < DURATION);
  const any = active.length > 0;
  useEffect(() => {
    if (!any) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [any]);
  // A new reveal arrives: re-render now, not on the next tick.
  useEffect(() => setNow(Date.now()), [reveals]);
  if (!editor || !any) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {active.map(([id, at]) => (
        <Live key={`${id}:${at}`} editor={editor} id={id} at={at} />
      ))}
    </div>
  );
}

function Live({ editor, id, at }: { editor: Editor; id: string; at: number }) {
  const ref = useRef<HTMLDivElement>(null);
  // Fixed once: changing an animation's delay mid-flight would restart it.
  const [base] = useState(() => Math.max(0, at - Date.now()));
  const shape = editor.scene.get(id);
  const theme = editor.renderer.theme.name;
  const w = Math.max(40, Math.round(shape?.w ?? 0));
  const h = Math.max(30, Math.round(shape?.h ?? 0));
  const svg = useMemo(() => (shape ? designSvg(shape.kind, shape.data, shape.label, w, h, CHART_THEMES[theme]) : ""), [shape?.kind, shape?.data, shape?.label, w, h, theme]);
  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const el = ref.current;
      const s = editor.renderer.lookup(id);
      if (!el || !s) return;
      const a = editor.renderer.worldToScreen({ x: s.x, y: s.y });
      const z = editor.renderer.viewport.zoom;
      el.style.transform = `translate(${a.x}px, ${a.y}px) scale(${z})`;
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [editor, id]);
  if (!shape || shape.rotation) return null;
  return (
    <div
      ref={ref}
      className="reveal absolute left-0 top-0 origin-top-left"
      style={{ width: w, height: h, ["--base" as string]: `${base}ms` }}
      // The SVG is our own output (charts.ts / slides.ts escape every string they draw).
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
