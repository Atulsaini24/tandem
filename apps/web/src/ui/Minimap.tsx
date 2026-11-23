import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { Editor } from "../canvas/editor";
import { boundsOf, visualBounds, type Rect } from "../canvas/geometry";
import { displayFill, hex } from "../canvas/theme";
import { useUiStore } from "../state/ui-store";
import { IconButton, panel, spring } from "./kit";

const W = 208;
const H = 136;

/**
 * An overview of the whole board with the visible area outlined. Click or drag on it to
 * fly there. Redrawn a few times a second from the scene (cheap: one rect per shape).
 */
export function Minimap({ editor }: { editor: Editor | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Collapsed by default when the canvas is narrow (panels open): it would cover the work.
  const [open, setOpen] = useState(() => window.innerWidth >= 1500);
  const zoom = useUiStore((s) => s.stats.zoom);
  const frame = useRef<{ world: Rect; scale: number; ox: number; oy: number } | undefined>(undefined);

  useEffect(() => {
    if (!editor || !open) return;
    let raf = 0;
    let last = 0;
    const draw = (time: number): void => {
      raf = requestAnimationFrame(draw);
      if (time - last < 120) return;
      last = time;
      const canvas = ref.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const dpr = Math.min(2, window.devicePixelRatio);
      if (canvas.width !== W * dpr) {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const shapes = editor.scene.ordered();
      const view = editor.renderer.visibleWorld;
      const content = boundsOf(shapes.slice(0, 6_000).map((s) => visualBounds(s, editor.lookup)));
      const world = boundsOf(content ? [content, view] : [view]) ?? view;
      const pad = 8;
      const scale = Math.min((W - pad * 2) / Math.max(1, world.w), (H - pad * 2) / Math.max(1, world.h));
      const ox = pad + (W - pad * 2 - world.w * scale) / 2 - world.x * scale;
      const oy = pad + (H - pad * 2 - world.h * scale) / 2 - world.y * scale;
      frame.current = { world, scale, ox, oy };
      const theme = editor.renderer.theme;
      for (const s of shapes.length > 6_000 ? shapes.slice(0, 6_000) : shapes) {
        if (s.kind === "arrow" || s.kind === "comment") continue;
        const b = s.rotation ? visualBounds(s, editor.lookup) : s;
        ctx.globalAlpha = s.kind === "frame" ? 0.25 : 0.9;
        ctx.fillStyle = hex(displayFill(s.fill, theme));
        ctx.fillRect(ox + b.x * scale, oy + b.y * scale, Math.max(1.5, b.w * scale), Math.max(1.5, b.h * scale));
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = hex(theme.selection);
      ctx.lineWidth = 1.5;
      ctx.fillStyle = `${hex(theme.selection)}14`;
      const vx = ox + view.x * scale;
      const vy = oy + view.y * scale;
      ctx.fillRect(vx, vy, view.w * scale, view.h * scale);
      ctx.strokeRect(vx, vy, view.w * scale, view.h * scale);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [editor, open]);

  const jump = (e: React.PointerEvent<HTMLCanvasElement>, ms: number): void => {
    const f = frame.current;
    if (!f || !editor) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const world = { x: (e.clientX - rect.left - f.ox) / f.scale, y: (e.clientY - rect.top - f.oy) / f.scale };
    editor.stopFollowing();
    editor.renderer.centerOn(world, undefined, ms);
  };

  return (
    <motion.div
      initial={{ y: 30, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ ...spring, delay: 0.1 }}
      className="pointer-events-none absolute bottom-[76px] right-4 hidden flex-col items-end gap-2 md:flex 2xl:bottom-4"
    >
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 8 }} transition={spring} className={`pointer-events-auto overflow-hidden ${panel}`}>
            <canvas
              ref={ref}
              style={{ width: W, height: H }}
              className="block cursor-pointer"
              aria-label="Minimap: click to move the view"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                jump(e, 380);
              }}
              onPointerMove={(e) => {
                if (e.buttons === 1) jump(e, 0.0001);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <div className={`pointer-events-auto flex items-center gap-0.5 p-1 ${panel}`}>
        <IconButton icon="minus" title="Zoom out (Ctrl -)" onClick={() => editor?.zoomBy(0.8)} disabled={!editor} />
        <button type="button" onClick={() => editor?.resetZoom()} title="Reset to 100%" className="h-9 w-14 rounded-xl font-mono text-[12px] font-semibold tabular-nums text-ink hover:bg-hover">
          {Math.round(zoom * 100)}%
        </button>
        <IconButton icon="plus" title="Zoom in (Ctrl +)" onClick={() => editor?.zoomBy(1.25)} disabled={!editor} />
        <IconButton icon="fit" title="Zoom to fit (Shift 1)" onClick={() => editor?.zoomToFit()} disabled={!editor} />
        <IconButton icon="map" title={open ? "Hide minimap" : "Show minimap"} onClick={() => setOpen(!open)} active={open} />
      </div>
    </motion.div>
  );
}
