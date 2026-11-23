import { AnimatePresence, motion } from "motion/react";
import type { Editor } from "../canvas/editor";
import { useUiStore, type TeamPhase } from "../state/ui-store";
import { Icon, panel, spring } from "./kit";

const STEPS: ReadonlyArray<{ phase: TeamPhase; label: string }> = [
  { phase: "thinking", label: "Ideas" },
  { phase: "brainstorm", label: "Brainstorm" },
  { phase: "organize", label: "Organize" },
  { phase: "vote", label: "Vote" },
  { phase: "done", label: "Done" },
];

const DOING: Record<TeamPhase, string> = {
  thinking: "The local AI is writing ideas…",
  brainstorm: "Everyone is writing their notes",
  organize: "Sorting notes into themes",
  vote: "Dot voting",
  done: "Session complete",
};

/**
 * The live strip for an AI team session: which phase it's in, how far along, and at the
 * end the winning idea with Keep / Remove.
 */
export function TeamBar({ editor }: { editor: Editor | null }) {
  const team = useUiStore((s) => s.team);
  const crowd = useUiStore((s) => s.crowd);
  const index = team ? STEPS.findIndex((s) => s.phase === team.phase) : -1;
  const pct = team && team.total > 0 ? team.done / team.total : 0;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[72px] z-10 flex justify-center px-4">
      <AnimatePresence>
        {team && editor && (
          <motion.div
            key="team"
            initial={{ y: -16, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -12, opacity: 0 }}
            transition={spring}
            className={`pointer-events-auto w-[560px] max-w-full overflow-hidden ${panel}`}
          >
            <div className="flex items-center gap-3 px-4 pb-2 pt-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Team session · {team.topic}</p>
                <AnimatePresence mode="popLayout">
                  <motion.p key={team.phase + (team.top ?? "")} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }} className="truncate text-[14px] font-bold text-ink">
                    {team.phase === "done" && team.top ? `🏆 Winner: ${team.top}` : DOING[team.phase]}
                    {team.total > 0 && team.phase !== "done" && <span className="ml-2 font-mono text-[12px] font-semibold text-muted">{team.done}/{team.total}</span>}
                  </motion.p>
                </AnimatePresence>
              </div>
              {crowd ? (
                <button type="button" onClick={() => editor.crowd.stop()} className="h-8 rounded-lg border border-line px-3 text-[12px] font-bold text-ink hover:bg-hover">
                  Stop
                </button>
              ) : (
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => useUiStore.getState().setTeam(undefined)} className="h-8 rounded-lg bg-ink px-3 text-[12px] font-bold text-paper">
                    Keep it
                  </button>
                  <button type="button" onClick={() => editor.crowd.cleanup()} className="h-8 rounded-lg border border-line px-3 text-[12px] font-bold text-ink hover:border-bad hover:text-bad">
                    Remove
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 px-4 pb-3">
              {STEPS.map((step, i) => {
                const state = i < index || team.phase === "done" ? "done" : i === index ? "now" : "next";
                return (
                  <div key={step.phase} className="flex flex-1 flex-col gap-1">
                    <div className="relative h-1.5 overflow-hidden rounded-full bg-line">
                      <motion.div
                        className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#7b6cff] to-[#ff8a5b]"
                        animate={{ width: state === "done" ? "100%" : state === "now" ? `${Math.max(8, (step.phase === "thinking" ? 0.5 : pct) * 100)}%` : "0%" }}
                        transition={{ type: "spring", stiffness: 120, damping: 22 }}
                      />
                      {state === "now" && step.phase === "thinking" && (
                        <motion.div className="absolute inset-y-0 w-1/3 rounded-full bg-white/60" animate={{ left: ["-33%", "100%"] }} transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }} />
                      )}
                    </div>
                    <span className={`flex items-center gap-1 text-[10px] font-bold ${state === "next" ? "text-muted" : "text-ink"}`}>
                      {state === "done" && <Icon name="check" className="h-3 w-3 text-good" />}
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
