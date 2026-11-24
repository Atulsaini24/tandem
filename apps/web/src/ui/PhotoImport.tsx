import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { Editor } from "../canvas/editor";
import { useUiStore } from "../state/ui-store";
import { Icon, Kbd, spring } from "./kit";

/**
 * Photo → board: shown when a photo is dropped, pasted or chosen. Preview it, add a hint
 * if you like ("a sprint retro", "a login flow"), and the local vision model rebuilds it
 * as editable notes, shapes and arrows.
 */
export function PhotoImport({ editor }: { editor: Editor | null }) {
  const image = useUiStore((s) => s.photoOffer);
  const [hint, setHint] = useState("");
  const close = (): void => useUiStore.getState().setPhotoOffer(undefined);
  return (
    <AnimatePresence>
      {image && editor && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") close();
          }}
        >
          <motion.div initial={{ y: 24, scale: 0.97 }} animate={{ y: 0, scale: 1 }} exit={{ y: 16, opacity: 0 }} transition={spring} className="w-[min(560px,100%)] overflow-hidden rounded-[26px] border border-edge bg-paper shadow-[0_40px_120px_rgba(0,0,0,0.45)]">
            <div className="relative max-h-[46vh] overflow-hidden bg-black">
              <img src={image.dataUrl} alt="" className="mx-auto max-h-[46vh] object-contain" />
              <motion.div className="pointer-events-none absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-[#5b8cff]/40 to-transparent" animate={{ top: ["-20%", "100%"] }} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }} />
            </div>
            <div className="space-y-3 p-5">
              <div>
                <p className="flex items-center gap-2 text-[17px] font-extrabold text-ink">
                  <Icon name="sparkle" className="h-4 w-4 text-accent" /> Turn this photo into a board
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted">The vision model on this computer reads every note, box and arrow and rebuilds them as editable shapes, laid out like the photo.</p>
              </div>
              <input
                autoFocus
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    void editor.ai.photo(image, hint);
                    useUiStore.getState().setAiOpen(true);
                    close();
                  }
                }}
                placeholder="Optional hint, e.g. “our sprint retro” or “a login flowchart”"
                className="h-10 w-full rounded-xl border border-line bg-field px-3 text-[13px] text-ink outline-none focus:border-accent"
              />
              <div className="flex gap-2">
                <button type="button" onClick={close} className="h-10 rounded-xl border border-line px-4 text-[13px] font-semibold text-ink hover:bg-hover">
                  Cancel <Kbd>Esc</Kbd>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void editor.ai.photo(image, hint);
                    useUiStore.getState().setAiOpen(true);
                    close();
                  }}
                  className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#5b8cff] to-[#b36bff] text-[13px] font-bold text-white shadow-[0_10px_24px_rgba(91,140,255,0.35)]"
                >
                  <Icon name="sparkle" className="h-4 w-4" /> Build the board
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
