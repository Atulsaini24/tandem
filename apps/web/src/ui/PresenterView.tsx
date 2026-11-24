import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { deckFrames, frameSvg } from "../canvas/deck-export";
import type { Editor } from "../canvas/editor";
import { useUiStore } from "../state/ui-store";
import { useSceneVersion } from "./useScene";

/**
 * Presenter view: a second window (put it on your laptop screen while the board shows on
 * the projector) with the current and next slide, your speaker notes, a timer and the
 * controls. It's the same app and the same state, so it can't drift out of sync.
 */
export function PresenterView({ editor }: { editor: Editor | null }) {
  const open = useUiStore((s) => s.presenterOpen);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const win = window.open("", "tandem-presenter", "width=1100,height=720");
    if (!win) {
      useUiStore.getState().setNotice("Allow pop-ups to open the presenter view");
      useUiStore.getState().setPresenterOpen(false);
      return;
    }
    win.document.title = "Presenter view · Tandem";
    win.document.body.innerHTML = "";
    // Bring the app's styles along.
    for (const node of document.querySelectorAll('style, link[rel="stylesheet"]')) win.document.head.appendChild(node.cloneNode(true));
    win.document.documentElement.className = document.documentElement.className;
    win.document.body.className = "theme-dark";
    win.document.body.style.cssText = "margin:0;background:#0b0d14;color:#fff;font-family:Inter,'Segoe UI',sans-serif";
    const root = win.document.createElement("div");
    win.document.body.appendChild(root);
    setHost(root);
    const onClose = (): void => useUiStore.getState().setPresenterOpen(false);
    win.addEventListener("beforeunload", onClose);
    const keys = (e: KeyboardEvent): void => {
      const p = useUiStore.getState().presenting;
      if (!editor || !p) return;
      if (["ArrowRight", "PageDown", " "].includes(e.key)) editor.goToSlide(p.index + 1);
      if (["ArrowLeft", "PageUp"].includes(e.key)) editor.goToSlide(p.index - 1);
    };
    win.addEventListener("keydown", keys);
    return () => {
      win.removeEventListener("beforeunload", onClose);
      win.close();
      setHost(null);
    };
  }, [open]);
  if (!open || !host || !editor) return null;
  return createPortal(<Panel editor={editor} />, host);
}

function Panel({ editor }: { editor: Editor }) {
  const presenting = useUiStore((s) => s.presenting);
  const version = useSceneVersion(editor, 500);
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const frames = useMemo(() => deckFrames(editor), [version, editor]);
  const index = presenting?.index ?? 0;
  const ids = presenting?.slides ?? frames.map((f) => f.frame.id);
  const cur = frames.find((f) => f.frame.id === ids[index]);
  const next = frames.find((f) => f.frame.id === ids[index + 1]);
  const svgOf = (f: (typeof frames)[number] | undefined): string => (f ? frameSvg(editor, f.frame).replace("<svg ", '<svg style="width:100%;height:100%" ') : "");
  const curSvg = useMemo(() => svgOf(cur), [cur?.frame.id, version]);
  const nextSvg = useMemo(() => svgOf(next), [next?.frame.id, version]);
  const secs = Math.floor((now - started) / 1000);
  const clock = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  return (
    <div className="grid h-screen grid-cols-[1.6fr_1fr] gap-4 p-4">
      <div className="flex min-h-0 flex-col gap-3">
        <div className="flex items-center justify-between text-[13px] font-semibold text-white/70">
          <span>
            Slide {index + 1} / {Math.max(1, ids.length)} · {cur?.title ?? "—"}
          </span>
          <span className="font-mono text-[22px] font-bold text-white">{clock}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-black" dangerouslySetInnerHTML={{ __html: curSvg }} />
        <div className="flex gap-2">
          <button type="button" onClick={() => editor.goToSlide(index - 1)} disabled={index === 0} className="h-12 flex-1 rounded-xl bg-white/10 text-[15px] font-bold hover:bg-white/20 disabled:opacity-30">
            ← Previous
          </button>
          <button type="button" onClick={() => editor.goToSlide(index + 1)} disabled={index >= ids.length - 1} className="h-12 flex-[2] rounded-xl bg-[#5b8cff] text-[15px] font-bold hover:brightness-110 disabled:opacity-30">
            Next →
          </button>
          <button type="button" onClick={() => editor.setLaser(!useUiStore.getState().laser)} className="h-12 rounded-xl bg-white/10 px-4 text-[14px] font-bold hover:bg-white/20">
            🔴 Laser
          </button>
          <button
            type="button"
            onClick={() => {
              editor.stopPresenting();
              useUiStore.getState().setPresenterOpen(false);
            }}
            className="h-12 rounded-xl bg-white/10 px-4 text-[14px] font-bold hover:bg-[#ff5c5c]"
          >
            End
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-col gap-3">
        <p className="text-[12px] font-bold uppercase tracking-wider text-white/50">Next</p>
        <div className="aspect-video overflow-hidden rounded-xl border border-white/10 bg-black opacity-80" dangerouslySetInnerHTML={{ __html: nextSvg || "" }} />
        <p className="text-[12px] font-bold uppercase tracking-wider text-white/50">Speaker notes</p>
        <div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-xl bg-white/5 p-4 text-[20px] leading-relaxed text-white/90">{cur?.notes || <span className="text-white/40">No notes for this slide. Add them in Studio (double-click a slide → Studio).</span>}</div>
        {!presenting && (
          <button type="button" onClick={() => editor.startPresenting()} className="h-11 rounded-xl bg-[#22c3a6] text-[14px] font-bold text-[#032019]">
            Start presenting
          </button>
        )}
      </div>
    </div>
  );
}
