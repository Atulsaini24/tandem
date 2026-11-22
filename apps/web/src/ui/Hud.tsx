import { AnimatePresence, motion } from "motion/react";
import { useUiStore, type BenchResult } from "../state/ui-store";

function fpsColor(fps: number): string {
  if (fps >= 55) return "bg-good";
  if (fps >= 40) return "bg-warn";
  return "bg-bad";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className="text-[10px] font-bold uppercase tracking-[0.09em] text-muted">{label}</span>
      <span className="font-mono text-[12px] tabular-nums text-ink">{value}</span>
    </div>
  );
}

/** 60fps leaves 16.7ms per frame; the app may use half, the rest is for GPU + browser. */
const WORK_BUDGET_MS = 8;

function BenchCard({ result }: { result: BenchResult }) {
  const pass = result.workP95Ms <= WORK_BUDGET_MS;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      className="w-64 rounded-2xl border border-black/10 bg-paper/95 p-4 shadow-[0_12px_32px_rgba(25,29,37,0.10)] backdrop-blur-md"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.09em] text-muted">Benchmark</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold text-white ${pass ? "bg-good" : "bg-bad"}`}>
          {pass ? "PASS" : "BELOW TARGET"}
        </span>
      </div>
      <div className="space-y-1.5">
        <Stat label="Frame work p95" value={`${result.workP95Ms} / ${WORK_BUDGET_MS} ms`} />
        <Stat label="Frame work median" value={`${result.workMedianMs} ms`} />
        <div className="my-2 h-px bg-line" />
        <Stat label="Avg fps (display)" value={result.avgFps.toFixed(1)} />
        <Stat label="p95 frame" value={`${result.p95FrameMs} ms`} />
        <Stat label="Worst frame" value={`${result.worstFrameMs} ms`} />
        <Stat label="Frames > 20ms" value={`${result.slowFrames} / ${result.frames}`} />
        <Stat label="Shapes" value={result.shapes.toLocaleString()} />
        <Stat label="Moved / frame" value={result.movedPerFrame.toLocaleString()} />
      </div>
    </motion.div>
  );
}

export function Hud() {
  const stats = useUiStore((s) => s.stats);
  const selected = useUiStore((s) => s.selection.size);
  const bench = useUiStore((s) => s.bench);
  return (
    <div className="pointer-events-none absolute bottom-4 left-4 flex flex-col items-start gap-3">
      <AnimatePresence>{bench && bench !== "running" && <BenchCard key="bench" result={bench} />}</AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 30, delay: 0.2 }}
        className="w-64 space-y-1.5 rounded-2xl border border-black/10 bg-paper/90 p-4 shadow-[0_12px_32px_rgba(25,29,37,0.08)] backdrop-blur-md"
      >
        <div className="flex items-baseline justify-between gap-6">
          <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.09em] text-muted">
            <motion.span
              className={`inline-block h-2 w-2 rounded-full ${fpsColor(stats.fps)}`}
              animate={{ scale: [1, 1.35, 1] }}
              transition={{ duration: 1.2, repeat: Infinity }}
            />
            FPS
          </span>
          <span className="font-mono text-[12px] tabular-nums text-ink">{stats.fps}</span>
        </div>
        <Stat label="p95 frame" value={`${stats.p95} ms`} />
        <Stat label="Shapes" value={stats.shapes.toLocaleString()} />
        <Stat label="Selected" value={selected.toLocaleString()} />
        <Stat label="Zoom" value={`${Math.round(stats.zoom * 100)}%`} />
        <Stat label="Engine" value={`${stats.engineMs} ms`} />
      </motion.div>
    </div>
  );
}

export function KeyHints() {
  const hints = [
    ["Space+drag", "pan"],
    ["⌘/Ctrl+wheel", "zoom"],
    ["Shift+click", "multi-select"],
    ["Del", "delete"],
    ["]", "to front"],
  ];
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.35 }}
      className="pointer-events-none absolute bottom-4 right-4 hidden flex-col items-end gap-1 md:flex"
    >
      {hints.map(([key, action]) => (
        <div key={key} className="text-[11px] text-muted">
          <span className="rounded border border-line border-b-2 bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink">{key}</span>{" "}
          {action}
        </div>
      ))}
    </motion.div>
  );
}
