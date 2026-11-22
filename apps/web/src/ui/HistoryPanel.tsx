import { AnimatePresence, motion } from "motion/react";
import type { Editor } from "../canvas/editor";
import { useUiStore } from "../state/ui-store";

const spring = { type: "spring", stiffness: 420, damping: 36 } as const;

/**
 * Time travel. Drag the slider through every version the server has stored: the canvas
 * animates to that version (read-only). "Restore" makes the live document match it as
 * one undoable step; "Back to live" leaves without changing anything.
 */
export function HistoryPanel({ editor }: { editor: Editor | null }) {
  const history = useUiStore((s) => s.history);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center px-4">
      <AnimatePresence>
        {history && (
          <motion.div
            key="history"
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0 }}
            transition={spring}
            className="pointer-events-auto w-full max-w-[640px] rounded-3xl border border-black/10 bg-paper/95 p-4 shadow-[0_18px_48px_rgba(25,29,37,0.16)] backdrop-blur-md"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.09em] text-muted">Time travel</div>
                <div className="text-[15px] font-semibold text-ink">
                  {history.head === 0 && history.loading ? (
                    "Loading history…"
                  ) : history.at >= history.head ? (
                    <>Latest version · {history.head} changes</>
                  ) : (
                    <>
                      Version {history.at} <span className="text-muted">of {history.head}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.96 }}
                  onClick={() => editor?.closeHistory()}
                  className="h-10 rounded-full px-4 text-[13px] font-semibold text-ink hover:bg-black/5"
                >
                  Back to live
                </motion.button>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.96 }}
                  disabled={history.loading || history.at >= history.head}
                  onClick={() => editor?.restoreVersion()}
                  className="h-10 rounded-full bg-ink px-4 text-[13px] font-semibold text-white disabled:opacity-30"
                >
                  Restore this version
                </motion.button>
              </div>
            </div>
            <input
              type="range"
              aria-label="Version"
              min={0}
              max={Math.max(1, history.head)}
              value={Math.min(history.at, history.head)}
              disabled={history.head === 0}
              onChange={(e) => editor?.scrubHistory(Number(e.target.value))}
              className="w-full accent-[var(--color-accent)]"
            />
            <div className="mt-1 flex justify-between font-mono text-[10px] text-muted">
              <span>empty</span>
              <motion.span animate={{ opacity: history.loading ? 1 : 0 }}>fetching…</motion.span>
              <span>now</span>
            </div>
            {history.error && <div className="mt-2 text-[12px] text-bad">{history.error}</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
