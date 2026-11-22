import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { VOTES_PER_PERSON, type Editor } from "../canvas/editor";
import { useUiStore } from "../state/ui-store";
import { Icon, panel, spring } from "./kit";

const PRESETS = [1, 3, 5, 10] as const;
const fmt = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** A little three-note chime (synthesized: no audio files). */
function chime(): void {
  try {
    const ctx = new AudioContext();
    [880, 1108.7, 1318.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.16;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 1);
    });
    setTimeout(() => void ctx.close(), 2_000);
  } catch {
    // no audio: the confetti still says it
  }
}

function Confetti({ burst }: { burst: number }) {
  const colors = ["#2f63ff", "#ff8a5b", "#ffd666", "#19c3a5", "#ff4f8b", "#7b6cff"];
  return (
    <AnimatePresence>
      {burst > 0 && (
        <motion.div key={burst} className="pointer-events-none fixed inset-0 z-[60] overflow-hidden" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ delay: 2.2, duration: 0.6 }}>
          {Array.from({ length: 90 }, (_, i) => {
            const x = (Math.random() - 0.5) * window.innerWidth * 1.1;
            return (
              <motion.span
                key={i}
                className="absolute left-1/2 top-[18%] h-2.5 w-1.5 rounded-[2px]"
                style={{ backgroundColor: colors[i % colors.length] }}
                initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
                animate={{ x, y: window.innerHeight * (0.6 + Math.random() * 0.5), rotate: Math.random() * 720 - 360 }}
                transition={{ duration: 1.8 + Math.random() * 1.2, ease: [0.15, 0.6, 0.4, 1] }}
              />
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The shared countdown, top center, on everyone's screen. Ends with a chime and confetti. */
export function TimerPill({ editor }: { editor: Editor | null }) {
  const timer = useUiStore((s) => s.timer);
  const running = timer.end > 0 && timer.paused === 0;
  const now = useNow(timer.end > 0);
  const left = timer.paused > 0 ? timer.paused : timer.end - now;
  const done = timer.end > 0 && timer.paused === 0 && left <= 0;
  const [burst, setBurst] = useState(0);
  const fired = useRef(0);
  useEffect(() => {
    if (done && fired.current !== timer.end) {
      fired.current = timer.end;
      chime();
      setBurst((b) => b + 1);
    }
  }, [done, timer.end]);
  const progress = timer.total > 0 ? Math.min(1, Math.max(0, left / timer.total)) : 0;
  const R = 15;
  const C = 2 * Math.PI * R;
  return (
    <>
      <Confetti burst={burst} />
      <AnimatePresence>
        {timer.end > 0 && editor && (
          <motion.div
            key="timer"
            initial={{ y: -30, opacity: 0, scale: 0.9 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -30, opacity: 0 }}
            transition={spring}
            className={`pointer-events-auto absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-2 py-1.5 pl-1.5 pr-2 ${panel} ${done ? "ring-2 ring-good" : left < 10_000 && running ? "ring-2 ring-bad" : ""}`}
          >
            <svg viewBox="0 0 36 36" className="h-9 w-9 -rotate-90">
              <circle cx="18" cy="18" r={R} className="fill-none stroke-line" strokeWidth="3.5" />
              <motion.circle cx="18" cy="18" r={R} className={`fill-none ${done ? "stroke-good" : left < 10_000 ? "stroke-bad" : "stroke-accent"}`} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={C} animate={{ strokeDashoffset: C * (1 - progress) }} transition={{ duration: 0.25 }} />
            </svg>
            <motion.span key={done ? "done" : "t"} animate={left < 10_000 && running ? { scale: [1, 1.08, 1] } : {}} transition={{ duration: 1, repeat: Infinity }} className="min-w-[56px] font-mono text-[18px] font-bold tabular-nums text-ink">
              {done ? "Time!" : fmt(left)}
            </motion.span>
            {!done && (timer.paused > 0 ? <PillButton icon="back2" label="Resume" flip onClick={() => editor.resumeTimer()} /> : <PillButton icon="minus" label="Pause" onClick={() => editor.pauseTimer()} />)}
            <PillButton icon="plus" label="+1 min" onClick={() => editor.addTime(60_000)} />
            <PillButton icon="close" label="Stop" onClick={() => editor.stopTimer()} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function PillButton({ icon, label, onClick, flip }: { icon: "back2" | "minus" | "plus" | "close"; label: string; onClick: () => void; flip?: boolean }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-hover hover:text-ink">
      <Icon name={icon} className={`h-4 w-4 ${flip ? "rotate-180" : ""}`} />
    </button>
  );
}

/** Facilitation tools: timer, dot voting, spotlight, present, and a simulated team. */
export function RitualsPanel({ editor }: { editor: Editor | null }) {
  const open = useUiStore((s) => s.ritualsOpen);
  const voting = useUiStore((s) => s.voting);
  const spotlight = useUiStore((s) => s.spotlight);
  const crowd = useUiStore((s) => s.crowd);
  const shapes = useUiStore((s) => s.stats.shapes);
  useNow(open && voting);
  const used = editor && voting ? editor.myVotes() : 0;
  void shapes;
  const close = (): void => useUiStore.getState().setRitualsOpen(false);
  return (
    <AnimatePresence>
      {open && editor && (
        <motion.div
          key="rituals"
          initial={{ y: 20, opacity: 0, scale: 0.97 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 16, opacity: 0, scale: 0.98 }}
          transition={spring}
          className={`pointer-events-auto absolute bottom-[84px] left-1/2 z-20 w-[380px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden p-0 ${panel}`}
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-[14px] font-bold text-ink">Team rituals</p>
            <button type="button" aria-label="Close" onClick={close} className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-hover">
              <Icon name="close" className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-3 p-4">
            <section>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Timer · everyone sees it</p>
              <div className="grid grid-cols-4 gap-2">
                {PRESETS.map((m) => (
                  <motion.button key={m} type="button" whileTap={{ scale: 0.94 }} onClick={() => editor.startTimer(m * 60_000)} className="h-11 rounded-xl border border-line bg-field text-[14px] font-bold text-ink hover:border-accent hover:text-accent">
                    {m} min
                  </motion.button>
                ))}
              </div>
            </section>
            <Toggle
              icon="star"
              title="Dot voting"
              detail={voting ? `Click notes to vote · ${Math.max(0, VOTES_PER_PERSON - used)} of ${VOTES_PER_PERSON} left` : `${VOTES_PER_PERSON} votes each; click a note to vote`}
              on={voting}
              onChange={(on) => useUiStore.getState().setVoting(on)}
              tint="#dd2f6e"
            />
            <Toggle icon="eye" title="Spotlight me" detail="Everyone on the board follows your view" on={spotlight} onChange={(on) => editor.setSpotlight(on)} tint="#19c3a5" />
            <Toggle icon="hand" title="Simulate a team" detail="8 bot teammates join and work live" on={crowd} onChange={(on) => (on ? editor.crowd.start() : editor.crowd.stop())} tint="#7b6cff" />
            <motion.button
              type="button"
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => {
                close();
                editor.startPresenting();
              }}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#2f63ff] to-[#7b6cff] text-[14px] font-bold text-white shadow-[0_12px_30px_rgba(47,99,255,0.35)]"
            >
              <Icon name="eye" className="h-4 w-4" /> Present — frames become slides
            </motion.button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Toggle({ icon, title, detail, on, onChange, tint }: { icon: "star" | "eye" | "hand"; title: string; detail: string; on: boolean; onChange: (on: boolean) => void; tint: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="flex w-full items-center gap-3 rounded-2xl border border-line bg-field p-3 text-left hover:border-ink/20">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white" style={{ backgroundColor: tint, boxShadow: on ? `0 0 20px ${tint}` : undefined }}>
        <Icon name={icon} className="h-4 w-4" />
      </span>
      <span className="flex-1">
        <span className="block text-[13px] font-bold text-ink">{title}</span>
        <span className="block text-[11px] text-muted">{detail}</span>
      </span>
      <span className={`relative h-6 w-10 rounded-full transition-colors ${on ? "bg-good" : "bg-line"}`}>
        <motion.span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow" animate={{ left: on ? 18 : 2 }} transition={spring} />
      </span>
    </button>
  );
}
