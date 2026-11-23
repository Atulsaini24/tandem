import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { REACTIONS } from "../canvas/controller";
import type { Editor } from "../canvas/editor";
import { useUiStore, type Tool } from "../state/ui-store";
import { Icon, IconButton, MOD, panel, spring, type IconName } from "./kit";

const TOOLS: ReadonlyArray<{ id: Tool; label: string; key: string; icon: IconName; edits: boolean }> = [
  { id: "select", label: "Select", key: "V", icon: "select", edits: false },
  { id: "hand", label: "Hand", key: "H", icon: "hand", edits: false },
  { id: "note", label: "Sticky note", key: "N", icon: "note", edits: true },
  { id: "rect", label: "Rectangle", key: "R", icon: "rect", edits: true },
  { id: "ellipse", label: "Ellipse", key: "O", icon: "ellipse", edits: true },
  { id: "diamond", label: "Diamond", key: "D", icon: "diamond", edits: true },
  { id: "arrow", label: "Connector — drag from one shape to another", key: "A", icon: "arrow", edits: true },
  { id: "pen", label: "Pen", key: "P", icon: "pen", edits: true },
  { id: "text", label: "Text", key: "T", icon: "text", edits: true },
  { id: "frame", label: "Frame", key: "F", icon: "frame", edits: true },
  { id: "comment", label: "Comment", key: "C", icon: "comment", edits: true },
];

function ToolButton({ tool, disabled }: { tool: (typeof TOOLS)[number]; disabled: boolean }) {
  const active = useUiStore((s) => s.tool === tool.id);
  const setTool = useUiStore((s) => s.setTool);
  return (
    <button
      type="button"
      onClick={() => setTool(tool.id)}
      disabled={disabled}
      title={`${tool.label} (${tool.key})`}
      aria-label={tool.label}
      aria-pressed={active}
      className="group relative grid h-10 w-10 place-items-center rounded-xl text-ink transition-colors hover:bg-hover disabled:opacity-25 disabled:hover:bg-transparent"
    >
      {active && <motion.span layoutId="tool-pill" transition={spring} className="absolute inset-0 rounded-xl bg-ink" />}
      <motion.span className={`relative ${active ? "text-paper" : ""}`} whileHover={{ y: -1.5 }} transition={spring}>
        <Icon name={tool.icon} />
      </motion.span>
      <span className="pointer-events-none absolute -top-11 left-1/2 z-10 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-[11px] font-semibold text-paper opacity-0 shadow-lg transition-all group-hover:translate-y-0 group-hover:opacity-100">
        {tool.label.split(" —")[0]} <span className="ml-1 rounded bg-paper/20 px-1 font-mono text-[10px]">{tool.key}</span>
      </span>
    </button>
  );
}

function Reactions({ editor }: { editor: Editor | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <IconButton icon="smile" title="React (1–6)" onClick={() => setOpen(!open)} active={open} disabled={!editor} />
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.95 }}
            transition={spring}
            className={`absolute bottom-14 left-1/2 flex -translate-x-1/2 gap-1 p-1.5 ${panel}`}
          >
            {REACTIONS.map((emoji, i) => (
              <motion.button
                key={emoji}
                type="button"
                title={`${emoji} (${i + 1})`}
                whileHover={{ scale: 1.25, y: -3 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => editor?.react(emoji)}
                className="grid h-10 w-10 place-items-center rounded-xl text-[22px] hover:bg-hover"
              >
                {emoji}
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The bottom dock: tools, undo/redo, reactions, AI and history. */
export function Toolbar({ editor }: { editor: Editor | null }) {
  const canUndo = useUiStore((s) => s.canUndo);
  const canRedo = useUiStore((s) => s.canRedo);
  const historyOpen = useUiStore((s) => s.history !== undefined);
  const online = useUiStore((s) => s.sync.status === "online");
  const viewOnly = useUiStore((s) => s.sync.readOnly || s.viewMode);
  const aiOpen = useUiStore((s) => s.aiOpen);
  const ritualsOpen = useUiStore((s) => s.ritualsOpen);
  const voting = useUiStore((s) => s.voting);
  const locked = historyOpen || viewOnly;
  return (
    <AnimatePresence>
      {!historyOpen && voting && (
        <motion.div key="voting" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }} className="pointer-events-none absolute inset-x-0 bottom-[78px] flex justify-center">
          <button type="button" onClick={() => useUiStore.getState().setVoting(false)} className="pointer-events-auto flex items-center gap-2 rounded-full bg-[#dd2f6e] px-4 py-2 text-[12px] font-bold text-white shadow-[0_10px_30px_rgba(221,47,110,0.45)]">
            <Icon name="star" className="h-3.5 w-3.5" filled /> Voting on — click notes to vote · Done
          </button>
        </motion.div>
      )}
      {!historyOpen && !viewOnly && !aiOpen && (
        <motion.button
          key="ai-fab"
          type="button"
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.6, opacity: 0 }}
          onClick={() => useUiStore.getState().setAiOpen(true)}
          className="pointer-events-auto absolute bottom-[86px] right-3 flex h-12 items-center gap-2 rounded-full bg-gradient-to-r from-[#5b8cff] to-[#b36bff] px-4 text-[14px] font-bold text-white shadow-[0_12px_30px_rgba(91,140,255,0.45)] sm:hidden"
        >
          <Icon name="sparkle" className="h-4 w-4" /> AI
        </motion.button>
      )}
      {!historyOpen && (
        <motion.div
          key="dock"
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={{ ...spring, delay: 0.05 }}
          className="pointer-events-none absolute inset-x-0 bottom-[max(12px,env(safe-area-inset-bottom))] flex justify-center px-2 sm:bottom-4 sm:px-4"
        >
          <div data-tour="dock" className={`scroll-quiet pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto p-1.5 [&>*]:shrink-0 ${panel}`}>
            {TOOLS.map((tool) => (
              <ToolButton key={tool.id} tool={tool} disabled={tool.edits && locked} />
            ))}
            <span className="mx-1 h-6 w-px shrink-0 bg-line" />
            <IconButton icon="undo" title={`Undo (${MOD}Z)`} disabled={!editor || !canUndo || locked} onClick={() => editor?.undo()} />
            <IconButton icon="redo" title={`Redo (${MOD}⇧Z)`} disabled={!editor || !canRedo || locked} onClick={() => editor?.redo()} />
            <Reactions editor={editor} />
            <span className="mx-1 h-6 w-px shrink-0 bg-line" />
            <motion.button
              type="button"
              data-tour="rituals"
              title="Team rituals: timer, voting, spotlight, present, simulated team"
              disabled={!editor}
              onClick={() => useUiStore.getState().setRitualsOpen(!useUiStore.getState().ritualsOpen)}
              whileTap={{ scale: 0.95 }}
              className={`flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold transition-colors disabled:opacity-30 ${ritualsOpen ? "bg-ink text-paper" : "text-ink hover:bg-hover"}`}
            >
              <Icon name="star" className="h-4 w-4" />
              <span className="hidden lg:inline">Rituals</span>
            </motion.button>
            <motion.button
              type="button"
              data-tour="ai"
              title={viewOnly ? "View only: AI edits are disabled" : "Local AI: generate, diagram, organize, summarize"}
              disabled={!editor || locked}
              onClick={() => useUiStore.getState().setAiOpen(!aiOpen)}
              whileTap={{ scale: 0.95 }}
              className={`flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold transition-colors disabled:opacity-30 ${aiOpen ? "bg-ink text-paper" : "bg-gradient-to-r from-[#2f63ff]/10 to-[#ff8a5b]/15 text-ink hover:from-[#2f63ff]/20 hover:to-[#ff8a5b]/25"}`}
            >
              <Icon name="sparkle" className="h-4 w-4" />
              AI
            </motion.button>
            <IconButton icon="history" title={online ? "Time travel: browse and restore versions" : "History needs a connection"} disabled={!editor || !online} onClick={() => editor?.openHistory()} />
            <IconButton icon="command" title={`Command palette (${MOD}K)`} disabled={!editor} onClick={() => useUiStore.getState().setPaletteOpen(true)} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
