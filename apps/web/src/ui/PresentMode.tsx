import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import type { Editor } from "../canvas/editor";
import { useUiStore } from "../state/ui-store";
import { Icon, Kbd } from "./kit";

/**
 * Present mode: frames are slides. The camera arcs from one to the next (pull back, then
 * dive in), everyone else on the board follows the presenter automatically, and L turns
 * the pointer into a laser everyone sees.
 */
export function PresentMode({ editor }: { editor: Editor | null }) {
  const presenting = useUiStore((s) => s.presenting);
  const laser = useUiStore((s) => s.laser);
  useEffect(() => {
    if (!presenting || !editor) return;
    const onKey = (e: KeyboardEvent): void => {
      const { presenting: p, laser: l } = useUiStore.getState();
      if (!p) return;
      if (["ArrowRight", "PageDown", " ", "Enter"].includes(e.key)) {
        e.preventDefault();
        editor.goToSlide(p.index + 1);
      } else if (["ArrowLeft", "PageUp", "Backspace"].includes(e.key)) {
        e.preventDefault();
        editor.goToSlide(p.index - 1);
      } else if (e.key.toLowerCase() === "l") editor.setLaser(!l);
      else if (e.key === "Escape") editor.stopPresenting();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presenting !== undefined, editor]);

  const count = Math.max(1, presenting?.slides.length ?? 1);
  const index = presenting?.index ?? 0;
  const frame = presenting && editor ? editor.scene.get(presenting.slides[index] ?? "") : undefined;
  return (
    <AnimatePresence>
      {presenting && editor && (
        <>
          <motion.div key="bar" className="pointer-events-none absolute inset-x-0 top-0 z-30 h-1 bg-white/10" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="h-full bg-gradient-to-r from-[#2f63ff] to-[#ff8a5b]" animate={{ width: `${((index + 1) / count) * 100}%` }} transition={{ type: "spring", stiffness: 120, damping: 24 }} />
          </motion.div>
          <motion.div
            key="controls"
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="absolute inset-x-0 bottom-6 z-30 flex justify-center px-4"
          >
            <div className="flex items-center gap-1 rounded-full border border-white/15 bg-[#0b0d14]/80 p-1.5 text-white shadow-[0_20px_60px_rgba(0,0,0,0.4)] backdrop-blur-xl">
              <button type="button" aria-label="Previous slide" onClick={() => editor.goToSlide(index - 1)} disabled={index === 0} className="grid h-11 w-11 place-items-center rounded-full hover:bg-white/10 disabled:opacity-30">
                <Icon name="back2" />
              </button>
              <div className="min-w-[160px] px-3 text-center">
                <AnimatePresence mode="popLayout">
                  <motion.p key={index} initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} className="text-[13px] font-bold">
                    {frame?.label ?? (presenting.slides.length === 0 ? "Whole board" : `Slide ${index + 1}`)}
                  </motion.p>
                </AnimatePresence>
                <p className="font-mono text-[10px] text-white/50">
                  {index + 1} / {count}
                </p>
              </div>
              <button type="button" aria-label="Next slide" onClick={() => editor.goToSlide(index + 1)} disabled={index >= count - 1} className="grid h-11 w-11 place-items-center rounded-full hover:bg-white/10 disabled:opacity-30">
                <Icon name="back2" className="h-[18px] w-[18px] rotate-180" />
              </button>
              <span className="mx-1 h-6 w-px bg-white/15" />
              <button
                type="button"
                onClick={() => editor.setLaser(!laser)}
                className={`flex h-11 items-center gap-2 rounded-full px-4 text-[13px] font-bold transition-colors ${laser ? "bg-[#ff3b3b] text-white shadow-[0_0_24px_rgba(255,59,59,0.7)]" : "hover:bg-white/10"}`}
              >
                <span className={`h-2.5 w-2.5 rounded-full ${laser ? "bg-white" : "bg-[#ff3b3b]"}`} /> Laser <Kbd>L</Kbd>
              </button>
              <button type="button" onClick={() => editor.stopPresenting()} className="flex h-11 items-center gap-2 rounded-full px-4 text-[13px] font-bold hover:bg-white/10">
                End <Kbd>Esc</Kbd>
              </button>
            </div>
          </motion.div>
          {presenting.slides.length === 0 && (
            <motion.p key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-x-0 top-6 z-30 text-center text-[12px] font-semibold text-muted">
              Tip: add frames (F) and each one becomes a slide.
            </motion.p>
          )}
        </>
      )}
    </AnimatePresence>
  );
}
