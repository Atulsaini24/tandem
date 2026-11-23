import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { REACTIONS } from "../canvas/controller";
import type { Editor } from "../canvas/editor";
import { TEMPLATES } from "../canvas/templates";
import { navigate } from "../router";
import { useUiStore, type Tool } from "../state/ui-store";
import { Icon, Kbd, MOD, spring, type IconName } from "./kit";

interface Command {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly icon: IconName;
  readonly keys?: string;
  readonly edits?: boolean;
  run(): void;
}

/** Subsequence match with a score that favors word starts and contiguous runs. */
export function fuzzyScore(query: string, text: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let score = 0;
  let ti = 0;
  let run = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return 0;
    run = found === ti ? run + 1 : 0;
    score += 1 + run * 2 + (found === 0 || t[found - 1] === " " ? 3 : 0);
    ti = found + 1;
  }
  return score / (t.length * 0.05 + 1);
}

function commands(editor: Editor, close: () => void): Command[] {
  const ui = useUiStore.getState();
  const tool = (id: Tool, label: string, icon: IconName, keys: string): Command => ({
    id: `tool-${id}`,
    label: `${label} tool`,
    group: "Tools",
    icon,
    keys,
    edits: id !== "select" && id !== "hand",
    run: () => ui.setTool(id),
  });
  return [
    tool("select", "Select", "select", "V"),
    tool("hand", "Hand", "hand", "H"),
    tool("note", "Sticky note", "note", "N"),
    tool("rect", "Rectangle", "rect", "R"),
    tool("ellipse", "Ellipse", "ellipse", "O"),
    tool("diamond", "Diamond", "diamond", "D"),
    tool("arrow", "Connector", "arrow", "A"),
    tool("pen", "Pen", "pen", "P"),
    tool("text", "Text", "text", "T"),
    tool("frame", "Frame", "frame", "F"),
    tool("comment", "Comment", "comment", "C"),
    ...TEMPLATES.map((t) => ({ id: `tpl-${t.id}`, label: `Insert template: ${t.name}`, group: "Templates", icon: "plus" as const, edits: true, run: () => editor.insertTemplate(t.id) })),
    { id: "ai", label: "Ask the AI…", group: "AI", icon: "sparkle", edits: true, run: () => ui.setAiOpen(true) },
    { id: "undo", label: "Undo", group: "Edit", icon: "undo", keys: `${MOD}Z`, edits: true, run: () => editor.undo() },
    { id: "redo", label: "Redo", group: "Edit", icon: "redo", keys: `${MOD}⇧Z`, edits: true, run: () => editor.redo() },
    { id: "all", label: "Select all", group: "Edit", icon: "select", keys: `${MOD}A`, run: () => editor.selectAll() },
    { id: "dup", label: "Duplicate selection", group: "Edit", icon: "copy", keys: `${MOD}D`, edits: true, run: () => editor.duplicate() },
    { id: "copy", label: "Copy", group: "Edit", icon: "copy", keys: `${MOD}C`, run: () => editor.copy() },
    { id: "paste", label: "Paste", group: "Edit", icon: "copy", keys: `${MOD}V`, edits: true, run: () => editor.paste() },
    { id: "frame", label: "Wrap selection in a frame", group: "Arrange", icon: "group", keys: `${MOD}G`, edits: true, run: () => editor.frameSelection() },
    { id: "front", label: "Bring to front", group: "Arrange", icon: "front", keys: "]", edits: true, run: () => editor.bringSelectionToFront() },
    { id: "back", label: "Send to back", group: "Arrange", icon: "back", keys: "[", edits: true, run: () => editor.sendSelectionToBack() },
    { id: "al", label: "Align left", group: "Arrange", icon: "alignLeft", edits: true, run: () => editor.align("left") },
    { id: "ac", label: "Align centers", group: "Arrange", icon: "alignCenter", edits: true, run: () => editor.align("center") },
    { id: "ar", label: "Align right", group: "Arrange", icon: "alignRight", edits: true, run: () => editor.align("right") },
    { id: "at", label: "Align top", group: "Arrange", icon: "alignTop", edits: true, run: () => editor.align("top") },
    { id: "am", label: "Align middles", group: "Arrange", icon: "alignMiddle", edits: true, run: () => editor.align("middle") },
    { id: "ab", label: "Align bottom", group: "Arrange", icon: "alignBottom", edits: true, run: () => editor.align("bottom") },
    { id: "dx", label: "Distribute horizontally", group: "Arrange", icon: "distributeX", edits: true, run: () => editor.distribute("x") },
    { id: "dy", label: "Distribute vertically", group: "Arrange", icon: "distributeY", edits: true, run: () => editor.distribute("y") },
    { id: "rot", label: "Rotate 90°", group: "Arrange", icon: "rotate", edits: true, run: () => editor.rotateSelection(Math.PI / 2) },
    { id: "del", label: "Delete selection", group: "Edit", icon: "trash", keys: "Del", edits: true, run: () => editor.deleteSelection() },
    { id: "fit", label: "Zoom to fit", group: "View", icon: "fit", keys: "⇧1", run: () => editor.zoomToFit() },
    { id: "zsel", label: "Zoom to selection", group: "View", icon: "search", keys: "⇧2", run: () => editor.zoomToSelection() },
    { id: "z100", label: "Zoom to 100%", group: "View", icon: "search", keys: `${MOD}0`, run: () => editor.resetZoom() },
    { id: "theme", label: "Toggle dark mode", group: "View", icon: "eye", run: () => ui.setTheme(ui.theme === "dark" ? "light" : "dark") },
    { id: "history", label: "Time travel: open history", group: "View", icon: "history", run: () => editor.openHistory() },
    { id: "png", label: "Export as PNG", group: "Export", icon: "download", run: () => void editor.exportPng() },
    { id: "svg", label: "Export as SVG", group: "Export", icon: "download", run: () => editor.exportSvg() },
    { id: "pdf", label: "Export as PDF", group: "Export", icon: "download", run: () => editor.exportPdf() },
    { id: "present", label: "Present: frames become slides", group: "Together", icon: "eye", run: () => editor.startPresenting() },
    { id: "crowd", label: editor.crowd.running ? "Stop the team session" : "Run an AI team session (8 bots brainstorm beside your board)", group: "Together", icon: "hand", run: () => (editor.crowd.running ? editor.crowd.stop() : editor.crowd.start()) },
    { id: "crowd-clean", label: "Remove the team session's frame and notes", group: "Together", icon: "trash", run: () => editor.crowd.cleanup() },
    { id: "vote", label: ui.voting ? "Stop dot voting" : "Start dot voting", group: "Together", icon: "star", run: () => ui.setVoting(!ui.voting) },
    { id: "timer5", label: "Start a 5-minute timer for everyone", group: "Together", icon: "history", edits: true, run: () => editor.startTimer(300_000) },
    { id: "spot", label: ui.spotlight ? "Stop spotlight" : "Spotlight me (everyone follows)", group: "Together", icon: "eye", run: () => editor.setSpotlight(!ui.spotlight) },
    { id: "rituals", label: "Open team rituals", group: "Together", icon: "star", run: () => ui.setRitualsOpen(true) },
    { id: "chat", label: "Cursor chat", group: "Together", icon: "chat", keys: "/", run: () => ui.setChat("") },
    ...REACTIONS.map((emoji, i) => ({ id: `r${i}`, label: `React ${emoji}`, group: "Together", icon: "smile" as const, keys: String(i + 1), run: () => editor.react(emoji) })),
    { id: "offline", label: ui.sync.wantOnline ? "Go offline (keep editing)" : "Go back online", group: "Together", icon: "link", run: () => editor.setOnline(!ui.sync.wantOnline) },
    { id: "boards", label: "Go to all boards", group: "Navigate", icon: "back2", run: () => navigate("/boards") },
    { id: "home", label: "Go to the homepage", group: "Navigate", icon: "back2", run: () => navigate("/") },
    { id: "spawn", label: "Stress test: add 5,000 shapes", group: "Developer", icon: "plus", edits: true, run: () => editor.spawn(5_000) },
    { id: "bench", label: "Benchmark: drag 500 shapes for 5 s", group: "Developer", icon: "rotate", run: () => void editor.benchmark() },
  ].map((c) => ({ ...c, run: () => (close(), c.run()) })) as Command[];
}

export function CommandPalette({ editor }: { editor: Editor | null }) {
  const open = useUiStore((s) => s.paletteOpen);
  return <AnimatePresence>{open && editor && <Palette key="palette" editor={editor} />}</AnimatePresence>;
}

function Palette({ editor }: { editor: Editor }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const close = (): void => useUiStore.getState().setPaletteOpen(false);
  const all = useMemo(() => commands(editor, close), [editor]);
  const locked = editor.locked;
  const results = useMemo(
    () =>
      all
        .filter((c) => !(locked && c.edits))
        .map((c) => ({ c, score: fuzzyScore(query, `${c.label} ${c.group}`) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => (query ? b.score - a.score : 0))
        .map((r) => r.c),
    [all, query, locked],
  );
  useEffect(() => input.current?.focus(), []);
  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  return (
    <motion.div className="absolute inset-0 z-40 flex items-start justify-center bg-ink/20 px-4 pt-[14vh] backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={close}>
      <motion.div
        role="dialog"
        aria-label="Command palette"
        initial={{ y: -12, scale: 0.97, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: -8, scale: 0.98, opacity: 0 }}
        transition={spring}
        onPointerDown={(e) => e.stopPropagation()}
        className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-edge bg-paper shadow-[0_30px_80px_rgba(17,19,24,0.3)]"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Icon name="search" className="h-5 w-5 text-muted" />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command, tool or template…"
            className="h-14 flex-1 bg-transparent text-[15px] font-medium text-ink outline-none placeholder:text-muted"
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") results[index]?.run();
            }}
          />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={list} className="scroll-quiet max-h-[52vh] overflow-y-auto p-2">
          {results.length === 0 && <p className="px-3 py-8 text-center text-[13px] text-muted">No matching commands</p>}
          {results.map((c, i) => (
            <button
              key={c.id}
              type="button"
              data-index={i}
              onPointerMove={() => setIndex(i)}
              onClick={() => c.run()}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${i === index ? "bg-hover" : ""}`}
            >
              <span className={`grid h-8 w-8 place-items-center rounded-lg ${i === index ? "bg-ink text-paper" : "bg-canvas text-ink"}`}>
                <Icon name={c.icon} className="h-4 w-4" />
              </span>
              <span className="flex-1 text-[14px] font-semibold text-ink">{c.label}</span>
              <span className="text-[11px] font-medium text-muted">{c.group}</span>
              {c.keys && <Kbd>{c.keys}</Kbd>}
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
