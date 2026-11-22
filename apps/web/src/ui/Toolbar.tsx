import { motion } from "motion/react";
import type { ReactNode } from "react";
import type { Editor } from "../canvas/editor";
import { useUiStore, type Tool } from "../state/ui-store";

const spring = { type: "spring", stiffness: 420, damping: 34 } as const;

const icons: Record<Tool, ReactNode> = {
  select: <path d="M5 3l14 8.5-6.2 1.3 3.7 6.4-2.6 1.5-3.7-6.4L5.5 18z" />,
  rect: <rect x="4" y="6" width="16" height="12" rx="2" />,
  ellipse: <ellipse cx="12" cy="12" rx="8" ry="6.5" />,
};

const TOOLS: ReadonlyArray<{ id: Tool; label: string; key: string }> = [
  { id: "select", label: "Select", key: "V" },
  { id: "rect", label: "Rectangle", key: "R" },
  { id: "ellipse", label: "Ellipse", key: "O" },
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

export function Toolbar({ editor }: { editor: Editor | null }) {
  const selected = useUiStore((s) => s.selection.size);
  const benchRunning = useUiStore((s) => s.bench === "running");
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
        <ActionButton title="Add 5,000 random shapes" disabled={!editor} onClick={() => editor?.spawn(5_000)}>
          +5,000
        </ActionButton>
        <ActionButton
          title="Drag 500 shapes while panning and zooming for 5 seconds"
          disabled={!editor || benchRunning}
          onClick={() => void editor?.benchmark()}
        >
          {benchRunning ? "Measuring…" : "Benchmark"}
        </ActionButton>
        <ActionButton title="Delete selection (Del)" disabled={!editor || selected === 0} onClick={() => editor?.deleteSelection()}>
          Delete
        </ActionButton>
      </motion.div>
    </div>
  );
}
