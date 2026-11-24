import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "../canvas/editor";
import { votePoll } from "../canvas/features";
import { NOTE_COLORS } from "../canvas/templates";
import { embedSrc, parseEmbed, parsePoll, tally } from "../canvas/widgets";
import { useUiStore } from "../state/ui-store";
import { useSceneVersion } from "./useScene";

/** Glue a DOM box to a shape's on-screen rectangle (pan, zoom, move, resize). */
function useGlue(editor: Editor, id: string, inset = 0): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const el = ref.current;
      const s = editor.renderer.lookup(id);
      if (!el || !s) return;
      const a = editor.renderer.worldToScreen({ x: s.x, y: s.y });
      const z = editor.renderer.viewport.zoom;
      el.style.transform = `translate(${a.x + inset * z}px, ${a.y + inset * z}px)`;
      el.style.width = `${Math.max(10, (s.w - inset * 2) * z)}px`;
      el.style.height = `${Math.max(10, (s.h - inset * 2) * z)}px`;
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [editor, id, inset]);
  return ref;
}

/**
 * Things that live on top of shapes: a live embedded page, a poll's vote buttons, and the
 * accept/dismiss buttons on the AI teammate's suggestions.
 */
export function Overlays({ editor }: { editor: Editor | null }) {
  const embed = useUiStore((s) => s.embedLive);
  const poll = useUiStore((s) => s.pollOpen);
  const suggestions = useUiStore((s) => s.suggestions);
  const version = useSceneVersion(editor, 250);
  // Forget suggestions whose card was deleted some other way.
  useEffect(() => {
    if (!editor) return;
    const ids = Object.keys(suggestions);
    const alive = ids.filter((id) => editor.scene.get(id));
    if (alive.length !== ids.length) useUiStore.getState().setSuggestions(Object.fromEntries(alive.map((id) => [id, suggestions[id] ?? ""])));
  }, [version, editor]);
  if (!editor) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {embed && editor.scene.get(embed) && <LiveEmbed key={embed} editor={editor} id={embed} />}
      {poll && editor.scene.get(poll) && <PollVote key={poll} editor={editor} id={poll} />}
      {Object.keys(suggestions).map((id) => (editor.scene.get(id) ? <SuggestionTools key={id} editor={editor} id={id} /> : null))}
    </div>
  );
}

function LiveEmbed({ editor, id }: { editor: Editor; id: string }) {
  const ref = useGlue(editor, id);
  const spec = useMemo(() => parseEmbed(editor.scene.get(id)?.data), [id, editor]);
  const src = spec ? embedSrc(spec) : undefined;
  const close = (): void => useUiStore.getState().setEmbedLive(undefined);
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  if (spec?.type === "code") return <CodeEdit editor={editor} id={id} glue={ref} code={spec.code} />;
  if (!src) return null;
  return (
    <div ref={ref} className="pointer-events-auto absolute left-0 top-0 overflow-hidden rounded-2xl bg-black shadow-2xl ring-2 ring-accent" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <iframe
        title={spec?.title || "Embedded page"}
        src={src}
        className="h-full w-full border-0"
        // Sandboxed: scripts for players, but no access to this app or its storage.
        sandbox="allow-scripts allow-same-origin allow-popups allow-presentation allow-forms"
        allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media"
        referrerPolicy="strict-origin-when-cross-origin"
      />
      <button type="button" onClick={close} className="absolute right-2 top-2 rounded-lg bg-black/70 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur">
        Done (Esc)
      </button>
    </div>
  );
}

function PollVote({ editor, id }: { editor: Editor; id: string }) {
  const ref = useGlue(editor, id);
  const version = useSceneVersion(editor, 150);
  const shape = editor.scene.get(id);
  const spec = parsePoll(shape?.data);
  void version;
  const close = (): void => useUiStore.getState().setPollOpen(undefined);
  useEffect(() => {
    const down = (e: PointerEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  }, []);
  if (!shape || !spec) return null;
  const { counts, total, mine } = tally(spec, shape.voters);
  const me = mine(editor.voterId);
  return (
    <div ref={ref} className="pointer-events-auto absolute left-0 top-0 flex flex-col justify-end rounded-[18px] bg-black/30 p-3 backdrop-blur-[1px]" onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex flex-col gap-1.5 rounded-2xl bg-[#0d1022]/90 p-2.5 shadow-2xl">
        <p className="px-1 text-[11px] font-bold uppercase tracking-wider text-[#ff9f7a]">Tap your answer · {total} voted</p>
        {spec.options.map((o, i) => (
          <button key={o} type="button" onClick={() => votePoll(editor, id, i)} className={`flex items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] font-bold text-white transition-colors ${me === i ? "bg-[#5b8cff]" : "bg-white/10 hover:bg-white/20"}`}>
            <span>
              {me === i ? "✓ " : ""}
              {o}
            </span>
            <span className="text-white/70">{counts[i] ?? 0}</span>
          </button>
        ))}
        <button type="button" onClick={close} className="mt-1 text-[11px] font-semibold text-white/60 hover:text-white">
          Done
        </button>
      </div>
    </div>
  );
}

function SuggestionTools({ editor, id }: { editor: Editor; id: string }) {
  const ref = useGlue(editor, id);
  const [busy, setBusy] = useState(false);
  const drop = (): void => {
    useUiStore.getState().setSuggestions(Object.fromEntries(Object.entries(useUiStore.getState().suggestions).filter(([key]) => key !== id)));
  };
  return (
    <div ref={ref} className="absolute left-0 top-0">
      <div className="pointer-events-auto absolute -top-4 right-2 flex items-center gap-1 rounded-full border border-white/20 bg-[#0d1022]/90 p-0.5 shadow-lg backdrop-blur" onPointerDown={(e) => e.stopPropagation()}>
        <span className="px-1.5 text-[10px] font-bold text-[#c9b8ff]">✨ AI</span>
        <button
          type="button"
          disabled={busy}
          title="Keep it"
          onClick={() => {
            setBusy(true);
            // Accepted: an ordinary note (yellow), no longer a suggestion.
            editor.updateShapes([{ id, patch: { fill: NOTE_COLORS.yellow } }], editor.beginGroup());
            drop();
          }}
          className="grid h-6 w-6 place-items-center rounded-full bg-[#22c3a6] text-[12px] font-black text-white"
        >
          ✓
        </button>
        <button
          type="button"
          disabled={busy}
          title="Dismiss"
          onClick={() => {
            setBusy(true);
            editor.deleteShapes([id]);
            drop();
          }}
          className="grid h-6 w-6 place-items-center rounded-full bg-white/15 text-[12px] font-black text-white hover:bg-[#ff5c5c]"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

/** Edit a code block in place (monospace, tab = two spaces); saved when you leave it. */
function CodeEdit({ editor, id, glue, code }: { editor: Editor; id: string; glue: React.RefObject<HTMLDivElement | null>; code: string }) {
  const [text, setText] = useState(code);
  const save = (): void => {
    const shape = editor.scene.get(id);
    if (shape?.data) {
      try {
        const data = JSON.parse(shape.data) as Record<string, unknown>;
        if (data.code !== text) editor.updateShapes([{ id, patch: { data: JSON.stringify({ ...data, code: text.slice(0, 6000) }) } }], editor.beginGroup());
      } catch {
        // unparseable: leave it
      }
    }
    useUiStore.getState().setEmbedLive(undefined);
  };
  return (
    <div ref={glue} className="pointer-events-auto absolute left-0 top-0 flex flex-col overflow-hidden rounded-2xl bg-[#0f1220] shadow-2xl ring-2 ring-accent" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between bg-[#171b2e] px-3 py-1.5">
        <span className="text-[11px] font-bold text-[#8b93b0]">Editing code · Esc or Done to save</span>
        <button type="button" onClick={save} className="rounded-md bg-[#5b8cff] px-2 py-0.5 text-[11px] font-bold text-white">
          Done
        </button>
      </div>
      <textarea
        autoFocus
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") save();
          if (e.key === "Tab") {
            e.preventDefault();
            const el = e.currentTarget;
            const at = el.selectionStart;
            setText(text.slice(0, at) + "  " + text.slice(el.selectionEnd));
            requestAnimationFrame(() => el.setSelectionRange(at + 2, at + 2));
          }
        }}
        className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-[13px] leading-relaxed text-[#e6e9f2] outline-none"
      />
    </div>
  );
}
