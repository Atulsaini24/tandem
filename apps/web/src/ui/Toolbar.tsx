import { motion } from "motion/react";
import type { ReactNode } from "react";
import type { Editor } from "../canvas/editor";
import { useUiStore, type Tool } from "../state/ui-store";

const spring = { type: "spring", stiffness: 420, damping: 34 } as const;

const icons: Record<Tool, ReactNode> = {
  select: <path d="M5 3l14 8.5-6.2 1.3 3.7 6.4-2.6 1.5-3.7-6.4L5.5 18z" />,
  rect: <rect x="4" y="6" width="16" height="12" rx="2" />,
  ellipse: <ellipse cx="12" cy="12" rx="8" ry="6.5" />,
  note: <path d="M5 4h14v11l-5 5H5zM14 20v-5h5" />,
};

const TOOLS: ReadonlyArray<{ id: Tool; label: string; key: string }> = [
  { id: "select", label: "Select", key: "V" },
  { id: "rect", label: "Rectangle", key: "R" },
  { id: "ellipse", label: "Ellipse", key: "O" },
  { id: "note", label: "Sticky note (double-click any shape to edit text)", key: "N" },
];

function ToolButton({ tool }: { tool: (typeof TOOLS)[number] }) {
  const active = useUiStore((s) => s.tool === tool.id);
  const setTool = useUiStore((s) => s.setTool);
  return (
    <button
      type="button"
      onClick={() => setTool(tool.id)}
      title={`${tool.label} (${tool.key})`}
      aria-pressed={active}
      className="relative grid h-10 w-10 place-items-center rounded-full text-ink transition-colors hover:bg-black/5"
    >
      {active && <motion.span layoutId="tool-pill" transition={spring} className="absolute inset-0 rounded-full bg-ink" />}
      <svg
        viewBox="0 0 24 24"
        className={`relative h-[18px] w-[18px] transition-colors ${active ? "fill-white stroke-white" : "fill-none stroke-ink"}`}
        strokeWidth={1.8}
        strokeLinejoin="round"
      >
        {icons[tool.id]}
      </svg>
    </button>
  );
}

function ActionButton({ onClick, disabled, children, title }: { onClick: () => void; disabled?: boolean; children: ReactNode; title: string }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      whileHover={disabled ? {} : { y: -1 }}
      whileTap={disabled ? {} : { scale: 0.96 }}
      transition={spring}
      className="h-10 rounded-full px-4 text-[13px] font-semibold text-ink transition-colors hover:bg-black/5 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </motion.button>
  );
}

function IconButton({ title, disabled, onClick, path }: { title: string; disabled: boolean; onClick: () => void; path: string }) {
  return (
    <motion.button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      whileTap={disabled ? {} : { scale: 0.9 }}
      transition={spring}
      className="grid h-10 w-10 place-items-center rounded-full text-ink transition-colors hover:bg-black/5 disabled:cursor-default disabled:opacity-25 disabled:hover:bg-transparent"
    >
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-none stroke-ink" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d={path} />
      </svg>
    </motion.button>
  );
}

const MOD = typeof navigator !== "undefined" && navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl+";

export function Toolbar({ editor }: { editor: Editor | null }) {
  const selected = useUiStore((s) => s.selection.size);
  const benchRunning = useUiStore((s) => s.bench === "running");
  const canUndo = useUiStore((s) => s.canUndo);
  const canRedo = useUiStore((s) => s.canRedo);
  const historyOpen = useUiStore((s) => s.history !== undefined);
  const online = useUiStore((s) => s.sync.status === "online");
  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center px-4">
      <motion.div
        initial={{ y: -28, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ ...spring, delay: 0.1 }}
        className="pointer-events-auto flex items-center gap-1 rounded-full border border-black/10 bg-paper/90 p-1.5 shadow-[0_12px_32px_rgba(25,29,37,0.10)] backdrop-blur-md"
      >
        {TOOLS.map((tool) => (
          <ToolButton key={tool.id} tool={tool} />
        ))}
        <span className="mx-1 h-6 w-px bg-line" />
        <IconButton
          title={`Undo (${MOD}Z)`}
          disabled={!editor || !canUndo || historyOpen}
          onClick={() => editor?.undo()}
          path="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11"
        />
        <IconButton
          title={`Redo (${MOD}⇧Z)`}
          disabled={!editor || !canRedo || historyOpen}
          onClick={() => editor?.redo()}
          path="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13"
        />
        <ActionButton
          title="Local AI: create or organize a board (runs on this device)"
          disabled={!editor || historyOpen}
          onClick={() => useUiStore.getState().setAiOpen(!useUiStore.getState().aiOpen)}
        >
          ✦ AI
        </ActionButton>
        <ActionButton
          title={online ? "Browse and restore earlier versions" : "History needs a connection"}
          disabled={!editor || !online}
          onClick={() => (historyOpen ? editor?.closeHistory() : editor?.openHistory())}
        >
          {historyOpen ? "Close history" : "History"}
        </ActionButton>
        <span className="mx-1 h-6 w-px bg-line" />
        <ActionButton title="Add 5,000 random shapes" disabled={!editor || historyOpen} onClick={() => editor?.spawn(5_000)}>
          +5,000
        </ActionButton>
        <ActionButton
          title="Drag 500 shapes while panning and zooming for 5 seconds"
          disabled={!editor || benchRunning}
          onClick={() => void editor?.benchmark()}
        >
          {benchRunning ? "Measuring…" : "Benchmark"}
        </ActionButton>
        <ActionButton title="Delete selection (Del)" disabled={!editor || selected === 0 || historyOpen} onClick={() => editor?.deleteSelection()}>
          Delete
        </ActionButton>
      </motion.div>
    </div>
  );
}
