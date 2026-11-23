import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { Editor } from "../canvas/editor";
import { TEMPLATES } from "../canvas/templates";
import { hex } from "../canvas/theme";
import { useUiStore } from "../state/ui-store";
import { Icon, Kbd, hexColor, panel, softSpring, spring } from "./kit";

/**
 * Cursor chat: press / and type. Every keystroke shows next to your cursor on everyone's
 * screen; Enter keeps it up for a few seconds, Esc clears it.
 */
export function CursorChat({ editor }: { editor: Editor | null }) {
  const chat = useUiStore((s) => s.chat);
  const me = useUiStore((s) => s.me);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const open = chat !== undefined;

  useEffect(() => {
    if (!open || !editor) return;
    input.current?.focus();
    let raf = 0;
    const place = (): void => {
      raf = requestAnimationFrame(place);
      const p = editor.pointer ?? editor.viewCenter();
      const s = editor.renderer.worldToScreen(p);
      if (box.current) box.current.style.transform = `translate(${s.x + 18}px, ${s.y + 18}px)`;
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, [open, editor]);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <AnimatePresence>
      {open && me && (
        <motion.div key="chat" ref={box} className="pointer-events-none absolute left-0 top-0 z-30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={spring} className="pointer-events-auto origin-top-left rounded-[18px] rounded-tl-md px-3.5 py-2 shadow-[0_10px_30px_rgba(17,19,24,0.25)]" style={{ backgroundColor: hexColor(me.color) }}>
            <input
              ref={input}
              value={chat}
              maxLength={120}
              placeholder="Say something…"
              onChange={(e) => {
                clearTimeout(timer.current);
                useUiStore.getState().setChat(e.target.value);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") useUiStore.getState().setChat(undefined);
                if (e.key === "Enter") {
                  input.current?.blur();
                  clearTimeout(timer.current);
                  timer.current = setTimeout(() => useUiStore.getState().setChat(undefined), 4_000);
                }
              }}
              onBlur={() => {
                if (!useUiStore.getState().chat) useUiStore.getState().setChat(undefined);
              }}
              className="w-56 bg-transparent text-[14px] font-semibold text-white outline-none placeholder:text-white/70"
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** A friendly start for an empty board: templates, or the keys to begin. */
export function EmptyState({ editor }: { editor: Editor | null }) {
  const locked = useUiStore((s) => s.sync.readOnly || s.viewMode);
  const selecting = useUiStore((s) => s.tool === "select");
  const [empty, setEmpty] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!editor) return;
    // Poll the scene (timers keep running in background tabs; frames may not).
    let zeroSince = 0;
    const timer = setInterval(() => {
      if (editor.scene.size > 0) {
        zeroSince = 0;
        setEmpty(false);
      } else {
        zeroSince ||= Date.now();
        setEmpty(Date.now() - zeroSince > 900);
      }
    }, 250);
    return () => clearInterval(timer);
  }, [editor]);
  const show = editor !== null && empty && !locked && selecting && !dismissed;
  return (
    <AnimatePresence>
      {show && (
        <motion.div key="empty" className="pointer-events-none absolute inset-0 flex items-center justify-center px-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
          <motion.div initial={{ y: 16, scale: 0.98 }} animate={{ y: 0, scale: 1 }} transition={softSpring} className={`pointer-events-auto w-[560px] max-w-full p-6 ${panel}`}>
            <p className="font-display text-[34px] leading-tight text-ink">A blank canvas.</p>
            <p className="mt-1 text-[14px] text-muted">
              Start from a template, press <Kbd>N</Kbd> for a sticky note, <Kbd>A</Kbd> to connect shapes, or ask the AI.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {TEMPLATES.slice(0, 4).map((t, i) => (
                <motion.button
                  key={t.id}
                  type="button"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...spring, delay: 0.05 * i }}
                  whileHover={{ y: -3 }}
                  onClick={() => {
                    setDismissed(true);
                    editor.insertTemplate(t.id);
                  }}
                  className="group rounded-2xl border border-line bg-field p-3 text-left hover:border-ink/30"
                >
                  <span className="mb-2 block h-1.5 w-8 rounded-full" style={{ backgroundColor: hex(t.color) }} />
                  <span className="block text-[13px] font-bold text-ink">{t.name}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted">{t.blurb}</span>
                </motion.button>
              ))}
              <motion.button
                type="button"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...spring, delay: 0.2 }}
                whileHover={{ y: -3 }}
                onClick={() => {
                  setDismissed(true);
                  useUiStore.getState().setGalleryOpen(true);
                }}
                className="rounded-2xl border border-ink/15 bg-ink p-3 text-left text-paper"
              >
                <span className="mb-1.5 block text-[18px]">✨</span>
                <span className="block text-[13px] font-bold">Browse all {TEMPLATES.length}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-paper/70">Decks, dashboards, canvases, 3D…</span>
              </motion.button>
              <motion.button
                type="button"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...spring, delay: 0.25 }}
                whileHover={{ y: -3 }}
                onClick={() => {
                  setDismissed(true);
                  useUiStore.getState().setAiOpen(true);
                }}
                className="rounded-2xl bg-gradient-to-br from-[#2f63ff] to-[#ff8a5b] p-3 text-left text-white"
              >
                <Icon name="sparkle" className="mb-1.5 h-5 w-5" />
                <span className="block text-[13px] font-bold">Ask the AI</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-white/85">Describe a board, flowchart or mind map.</span>
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
