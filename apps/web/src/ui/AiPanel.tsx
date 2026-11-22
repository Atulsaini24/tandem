import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Editor } from "../canvas/editor";
import { useUiStore } from "../state/ui-store";

const spring = { type: "spring", stiffness: 420, damping: 36 } as const;

const SUGGESTIONS = [
  "Plan a mobile app launch",
  "Retro: what went well, what didn't, actions",
  "Weekend trip to the mountains: packing, food, route",
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
 * The local AI assistant. Runs on Ollama on this machine: nothing leaves it.
 * Cards appear on the canvas while the model is still writing.
 */
export function AiPanel({ editor }: { editor: Editor | null }) {
  const open = useUiStore((s) => s.aiOpen);
  const ai = useUiStore((s) => s.ai);
  const selectionSize = useUiStore((s) => s.selection.size);
  const [prompt, setPrompt] = useState("");
  const running = ai.status === "thinking" || ai.status === "writing";
  const elapsed = useElapsed(ai.startedAt, running);
  const organizable = editor ? editor.ai.organizable().length : 0;
  void selectionSize; // re-render when the selection changes, so the organize count is fresh

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="ai"
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 30, opacity: 0 }}
          transition={spring}
          className="pointer-events-auto absolute right-4 top-24 w-[340px] rounded-3xl border border-black/10 bg-paper/95 p-4 shadow-[0_18px_48px_rgba(25,29,37,0.16)] backdrop-blur-md"
        >
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.09em] text-muted">Local AI · runs on this device</div>
              <div className="text-[15px] font-semibold text-ink">What should the board be about?</div>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={() => useUiStore.getState().setAiOpen(false)}
              className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-black/5"
            >
              ✕
            </button>
          </div>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !running) void editor?.ai.generate(prompt);
            }}
            rows={3}
            maxLength={2000}
            placeholder="e.g. Plan a mobile app launch"
            className="w-full resize-none rounded-2xl border border-line bg-white p-3 text-[14px] text-ink outline-none focus:border-accent"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setPrompt(s)}
                className="rounded-full border border-line bg-white px-2.5 py-1 text-[11px] font-medium text-muted hover:text-ink"
              >
                {s}
              </button>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            {running ? (
              <motion.button
                type="button"
                whileTap={{ scale: 0.96 }}
                onClick={() => editor?.ai.cancel()}
                className="h-10 flex-1 rounded-full border border-line text-[13px] font-semibold text-ink hover:bg-black/5"
              >
                Stop
              </motion.button>
            ) : (
              <>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.96 }}
                  disabled={!editor}
                  onClick={() => void editor?.ai.generate(prompt)}
                  className="h-10 flex-1 rounded-full bg-ink text-[13px] font-semibold text-white disabled:opacity-30"
                >
                  Create board
                </motion.button>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.96 }}
                  disabled={!editor || organizable < 2}
                  title={organizable < 2 ? "Select at least 2 shapes with text" : `Sort the ${organizable} selected notes into columns`}
                  onClick={() => void editor?.ai.organize(prompt)}
                  className="h-10 flex-1 rounded-full border border-line text-[13px] font-semibold text-ink hover:bg-black/5 disabled:opacity-30"
                >
                  Organize {organizable >= 2 ? organizable : ""} notes
                </motion.button>
              </>
            )}
          </div>

          <AnimatePresence mode="popLayout">
            {ai.status !== "idle" && (
              <motion.div
                key={ai.status}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={`mt-3 rounded-2xl px-3 py-2.5 text-[12px] ${ai.status === "error" ? "bg-bad/10 text-bad" : "bg-black/[0.04] text-ink"}`}
              >
                {ai.status === "thinking" && <>Thinking… {elapsed.toFixed(0)}s (the first run loads the model)</>}
                {ai.status === "writing" && (
                  <>
                    Placing cards: <b>{ai.items}</b> so far · {elapsed.toFixed(0)}s
                  </>
                )}
                {ai.status === "done" && (
                  <>
                    Done: <b>{ai.items}</b> cards in {elapsed.toFixed(0)}s
                    {ai.tokensPerSecond ? ` · ${ai.tokensPerSecond} tok/s` : ""}. Undo removes it in one step.
                    {ai.message ? <div className="mt-1 text-muted">{ai.message}</div> : null}
                  </>
                )}
                {(ai.status === "error" || ai.status === "cancelled") && ai.message}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
