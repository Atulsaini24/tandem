import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useState } from "react";
import { MOD } from "./kit";

const KEY = "canvas:tour-done";

const STEPS: ReadonlyArray<{ target: string; title: string; body: string }> = [
  { target: "dock", title: "Everything starts here", body: "Notes, shapes, connectors, pen, frames, comments. Every tool has a one-key shortcut — hover to see it." },
  { target: "canvas", title: "Hover, then click +", body: "Hover any shape and blue + handles appear: click one to create the next step, already connected. Right-click anywhere for the radial menu." },
  { target: "rituals", title: "Run the meeting", body: "A shared timer, dot voting, spotlight, present mode with a laser — and a simulated team if you want to see it busy." },
  { target: "ai", title: "Your private AI", body: "Boards, flowcharts and mind maps that draw themselves, plus summaries. It runs on your machine." },
  { target: "share", title: "Bring people in", body: `Share an edit or view-only link. Press ${MOD}K any time for every command.` },
];

function readDone(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true;
  }
}

/** A five-step spotlight tour, shown once per browser. */
export function Tour({ ready }: { ready: boolean }) {
  const [step, setStep] = useState<number | undefined>(undefined);
  const [rect, setRect] = useState<DOMRect | undefined>(undefined);
  useEffect(() => {
    if (!ready || readDone()) return;
    const t = setTimeout(() => setStep(0), 1_400);
    return () => clearTimeout(t);
  }, [ready]);
  const current = step === undefined ? undefined : STEPS[step];
  useLayoutEffect(() => {
    if (!current) return;
    const measure = (): void => {
      if (current.target === "canvas") {
        const w = Math.min(520, window.innerWidth * 0.5);
        setRect(new DOMRect(window.innerWidth / 2 - w / 2, window.innerHeight / 2 - 150, w, 300));
        return;
      }
      const el = document.querySelector(`[data-tour="${current.target}"]`);
      setRect(el?.getBoundingClientRect());
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [current]);
  const finish = (): void => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // fine: the tour just shows again
    }
    setStep(undefined);
  };
  const pad = 10;
  const box = rect ? { x: rect.x - pad, y: rect.y - pad, w: rect.width + pad * 2, h: rect.height + pad * 2 } : undefined;
  const below = box ? box.y + box.h + 220 < window.innerHeight : true;
  const cardX = box ? Math.min(window.innerWidth - 356, Math.max(16, box.x + box.w / 2 - 170)) : 16;
  const cardY = box ? (below ? box.y + box.h + 14 : box.y - 14) : 80;
  return (
    <AnimatePresence>
      {current && box && step !== undefined && (
        <motion.div key="tour" className="fixed inset-0 z-[70]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div
            className="absolute rounded-2xl ring-2 ring-accent"
            initial={false}
            animate={{ left: box.x, top: box.y, width: box.w, height: box.h }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
            style={{ boxShadow: "0 0 0 9999px rgba(8,10,16,0.6)" }}
          />
          <motion.div
            className="absolute w-[340px] rounded-3xl border border-edge bg-paper p-5 shadow-[0_30px_80px_rgba(0,0,0,0.35)]"
            initial={false}
            animate={{ left: cardX, top: cardY, y: below ? 0 : "-100%" }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
          >
            <div className="mb-3 flex gap-1.5">
              {STEPS.map((_, i) => (
                <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? "w-6 bg-accent" : "w-1.5 bg-line"}`} />
              ))}
            </div>
            <AnimatePresence mode="popLayout">
              <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}>
                <p className="text-[16px] font-extrabold text-ink">{current.title}</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{current.body}</p>
              </motion.div>
            </AnimatePresence>
            <div className="mt-4 flex items-center justify-between">
              <button type="button" onClick={finish} className="text-[12px] font-semibold text-muted hover:text-ink">
                Skip tour
              </button>
              <button type="button" onClick={() => (step >= STEPS.length - 1 ? finish() : setStep(step + 1))} className="h-9 rounded-xl bg-ink px-4 text-[13px] font-bold text-paper">
                {step >= STEPS.length - 1 ? "Start creating" : "Next"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
