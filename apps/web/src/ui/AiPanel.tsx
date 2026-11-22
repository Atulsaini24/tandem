import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Editor } from "../canvas/editor";
import { useUiStore } from "../state/ui-store";
import { Icon, Kbd, MOD, spring, type IconName } from "./kit";

type Mode = "board" | "flowchart" | "mindmap" | "insight";

const MODES: ReadonlyArray<{ id: Mode; label: string; icon: IconName; placeholder: string; action: string; examples: readonly string[] }> = [
  {
    id: "board",
    label: "Board",
    icon: "frame",
    placeholder: "e.g. Plan a mobile app launch",
    action: "Create board",
    examples: ["Plan a mobile app launch", "Retro: wins, problems, actions", "Weekend trip: packing, food, route"],
  },
  {
    id: "flowchart",
    label: "Flowchart",
    icon: "arrow",
    placeholder: "e.g. How a support ticket gets resolved",
    action: "Draw flowchart",
    examples: ["How a pull request gets merged", "Customer refund process", "Hiring pipeline"],
  },
  {
    id: "mindmap",
    label: "Mind map",
    icon: "sparkle",
    placeholder: "e.g. Ideas for our team offsite",
    action: "Draw mind map",
    examples: ["Ideas for a team offsite", "Growing a newsletter", "Learning machine learning"],
  },
  {
    id: "insight",
    label: "Summarize",
    icon: "search",
    placeholder: "Optional focus, e.g. risks for the launch",
    action: "Summarize board",
    examples: ["What are the risks?", "What should we do next?", "Who owns what?"],
  },
];

function useElapsed(startedAt: number | undefined, running: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [running]);
  return startedAt ? Math.max(0, (running ? now : Date.now()) - startedAt) / 1000 : 0;
}

/**
 * The local AI assistant (Ollama on this machine: nothing leaves it). Four jobs: make a
 * board, draw a flowchart or mind map with real connectors, or read the board and write
 * a summary plus what's missing. Results stream onto the canvas as the model writes, and
 * each run is a single undo step.
 */
export function AiPanel({ editor }: { editor: Editor | null }) {
  const open = useUiStore((s) => s.aiOpen);
  const ai = useUiStore((s) => s.ai);
  const selectionSize = useUiStore((s) => s.selection.size);
  const [mode, setMode] = useState<Mode>("board");
  const [prompt, setPrompt] = useState("");
  const running = ai.status === "thinking" || ai.status === "writing";
  const elapsed = useElapsed(ai.startedAt, running);
  const organizable = editor ? editor.ai.organizable().length : 0;
  const current = MODES.find((m) => m.id === mode) ?? MODES[0];
  void selectionSize; // re-render when the selection changes, so the counts are fresh

  const run = (): void => {
    if (!editor || running) return;
    if (mode === "board") void editor.ai.generate(prompt);
    else if (mode === "flowchart" || mode === "mindmap") void editor.ai.diagram(mode, prompt);
    else void editor.ai.insight(prompt);
  };

  return (
    <AnimatePresence>
      {open && current && (
        <motion.aside
          key="ai"
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 30, opacity: 0 }}
          transition={spring}
          className="pointer-events-auto absolute right-4 top-[76px] w-[360px] max-w-[calc(100vw-32px)] overflow-hidden rounded-3xl border border-edge bg-paper/95 shadow-[0_18px_48px_rgba(25,29,37,0.16)] backdrop-blur-md"
        >
          <div className="relative overflow-hidden bg-gradient-to-br from-[#2f63ff] to-[#ff8a5b] px-4 pb-4 pt-3.5 text-white">
            <motion.div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/20 blur-2xl" animate={{ x: [0, -20, 0], y: [0, 10, 0] }} transition={{ duration: 6, repeat: Infinity }} />
            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/20">
                  <Icon name="sparkle" className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-[14px] font-bold leading-tight">AI assistant</div>
                  <div className="text-[11px] text-white/80">Runs on this device · private</div>
                </div>
              </div>
              <button type="button" aria-label="Close" onClick={() => useUiStore.getState().setAiOpen(false)} className="grid h-8 w-8 place-items-center rounded-xl hover:bg-white/20">
                <Icon name="close" className="h-4 w-4" />
              </button>
            </div>
            <div className="relative mt-3 grid grid-cols-4 gap-1 rounded-2xl bg-black/15 p-1">
              {MODES.map((m) => (
                <button key={m.id} type="button" onClick={() => setMode(m.id)} className="relative rounded-xl px-1 py-1.5 text-[11px] font-bold">
                  {mode === m.id && <motion.span layoutId="ai-mode" transition={spring} className="absolute inset-0 rounded-xl bg-white shadow" />}
                  <span className={`relative ${mode === m.id ? "text-[#2f63ff]" : "text-white"}`}>{m.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="p-4">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) run();
              }}
              rows={3}
              maxLength={2000}
              placeholder={current.placeholder}
              className="w-full resize-none rounded-2xl border border-line bg-field p-3 text-[14px] text-ink outline-none placeholder:text-muted focus:border-accent"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {current.examples.map((s) => (
                <button key={s} type="button" onClick={() => setPrompt(s)} className="rounded-full border border-line bg-field px-2.5 py-1 text-[11px] font-medium text-muted hover:border-ink/30 hover:text-ink">
                  {s}
                </button>
              ))}
            </div>
            {mode === "insight" && (
              <p className="mt-2 text-[11px] leading-relaxed text-muted">
                Reads {selectionSize > 0 ? `the ${selectionSize} selected item${selectionSize === 1 ? "" : "s"}` : "the whole board"} and writes a summary, the key points and <b className="text-ink">what's missing</b>, in a frame beside it.
              </p>
            )}

            <div className="mt-3 flex gap-2">
              {running ? (
                <motion.button type="button" whileTap={{ scale: 0.96 }} onClick={() => editor?.ai.cancel()} className="h-10 flex-1 rounded-xl border border-line text-[13px] font-semibold text-ink hover:bg-hover">
                  Stop
                </motion.button>
              ) : (
                <>
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.96 }}
                    disabled={!editor}
                    onClick={run}
                    className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-ink text-[13px] font-semibold text-paper disabled:opacity-30"
                  >
                    <Icon name={current.icon} className="h-4 w-4" />
                    {current.action}
                  </motion.button>
                  {mode === "board" && (
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.96 }}
                      disabled={!editor || organizable < 2}
                      title={organizable < 2 ? "Select at least 2 shapes with text" : `Sort the ${organizable} selected notes into columns`}
                      onClick={() => void editor?.ai.organize(prompt)}
                      className="h-10 rounded-xl border border-line px-3 text-[13px] font-semibold text-ink hover:bg-hover disabled:opacity-30"
                    >
                      Organize {organizable >= 2 ? organizable : ""}
                    </motion.button>
                  )}
                </>
              )}
            </div>
            <p className="mt-2 text-center text-[10px] text-muted">
              <Kbd>{MOD}Enter</Kbd> to run · Undo removes a whole run
            </p>

            <AnimatePresence mode="popLayout">
              {ai.status !== "idle" && (
                <motion.div
                  key={ai.status}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className={`mt-3 rounded-2xl px-3 py-2.5 text-[12px] ${ai.status === "error" ? "bg-bad/10 text-bad" : "bg-hover text-ink"}`}
                >
                  {ai.status === "thinking" && (
                    <span className="flex items-center gap-2">
                      <motion.span className="h-2 w-2 rounded-full bg-accent" animate={{ scale: [1, 1.6, 1], opacity: [1, 0.4, 1] }} transition={{ duration: 1, repeat: Infinity }} />
                      Thinking… {elapsed.toFixed(0)}s (the first run loads the model)
                    </span>
                  )}
                  {ai.status === "writing" && (
                    <>
                      Writing: <b>{ai.items}</b> so far · {elapsed.toFixed(0)}s
                    </>
                  )}
                  {ai.status === "done" && (
                    <>
                      Done: <b>{ai.items}</b> {ai.mode === "insight" ? "insights" : ai.mode === "diagram" ? "steps" : "cards"} in {elapsed.toFixed(0)}s
                      {ai.tokensPerSecond ? ` · ${ai.tokensPerSecond} tok/s` : ""}.
                      {ai.message ? <div className="mt-1 text-muted">{ai.message}</div> : null}
                    </>
                  )}
                  {(ai.status === "error" || ai.status === "cancelled") && ai.message}
                  {ai.mode === "insight" && ai.summary && ai.status !== "error" && <p className="mt-2 border-t border-line pt-2 text-[12px] leading-relaxed text-ink">{ai.summary}</p>}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
