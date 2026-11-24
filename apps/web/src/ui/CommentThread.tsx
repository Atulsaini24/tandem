import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { addReply, deleteReply, isResolved, mentionable, mentions, repliesOf, setResolved, splitMentions, threads } from "../canvas/comments";
import type { Editor } from "../canvas/editor";
import { useUiStore } from "../state/ui-store";
import { useSceneVersion } from "./useScene";

const hex = (c: number): string => `#${c.toString(16).padStart(6, "0")}`;

function ago(at: number): string {
  if (!at) return "";
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

function Rich({ text, names }: { text: string; names: readonly string[] }) {
  return (
    <>
      {splitMentions(text, names).map((part, i) =>
        part.mention ? (
          <span key={i} className="rounded bg-accent/15 px-0.5 font-bold text-accent">
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/**
 * The open thread of the selected comment: the first message, every reply, a reply box
 * with @mention suggestions, and Resolve. It sits where the comment's card is.
 */
export function CommentThread({ editor }: { editor: Editor | null }) {
  const selection = useUiStore((s) => s.selection);
  const editing = useUiStore((s) => s.editing);
  const version = useSceneVersion(editor, 150);
  if (!editor || selection.size !== 1) return null;
  const [id] = [...selection];
  const view = id ? editor.scene.get(id) : undefined;
  if (!id || !view || view.kind !== "comment" || editing === id || !(view.label ?? "").trim()) return null;
  return <Thread key={id} editor={editor} id={id} version={version} />;
}

function Thread({ editor, id, version }: { editor: Editor; id: string; version: number }) {
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [pick, setPick] = useState(0);
  const view = editor.scene.get(id);
  const replies = useMemo(() => repliesOf(view), [view, version]);
  const names = useMemo(() => mentionable(editor), [editor, version]);
  const resolved = isResolved(view);
  const me = editor.me;
  // Follow the comment around the screen.
  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const s = editor.renderer.lookup(id);
      const el = box.current;
      if (!s || !el) return;
      const p = editor.renderer.worldToScreen({ x: s.x + s.w + 6, y: s.y - 4 });
      const maxX = window.innerWidth - el.offsetWidth - 12;
      const maxY = window.innerHeight - el.offsetHeight - 12;
      el.style.transform = `translate(${Math.max(8, Math.min(maxX, p.x))}px, ${Math.max(56, Math.min(maxY, p.y))}px)`;
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [editor, id]);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [replies.length]);
  // "@par" → suggest names starting with "par".
  const query = /(?:^|\s)@([^@\n]{0,24})$/.exec(draft)?.[1];
  const matches = query === undefined ? [] : names.filter((n) => n.toLowerCase().startsWith(query.toLowerCase()) && n !== me.name).slice(0, 5);
  const complete = (name: string): void => {
    setDraft(draft.replace(/@([^@\n]{0,24})$/, `@${name} `));
    setPick(0);
  };
  const send = (): void => {
    if (!draft.trim()) return;
    addReply(editor, id, draft, me);
    setDraft("");
  };
  if (!view) return null;
  return (
    <motion.div
      ref={box}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="pointer-events-auto fixed left-0 top-0 z-30 w-[320px] overflow-hidden rounded-2xl border border-line bg-paper text-ink shadow-2xl"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="text-[12px] font-bold text-muted">
          Thread · {replies.length + 1} message{replies.length === 0 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={() => setResolved(editor, id, !resolved)}
          className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${resolved ? "bg-[#22c3a6]/15 text-[#14a58c]" : "border border-line hover:bg-hover"}`}
        >
          {resolved ? "✓ Resolved · reopen" : "✓ Resolve"}
        </button>
      </div>
      <div ref={list} className="max-h-[300px] space-y-3 overflow-y-auto px-3 py-3">
        <Message author={view.author ?? "Someone"} color={view.fill} text={view.label ?? ""} at={0} names={names} />
        <AnimatePresence initial={false}>
          {replies.map((r) => (
            <motion.div key={r.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <Message author={r.author} color={r.color} text={r.text} at={r.at} names={names} {...(r.by === me.id ? { onDelete: () => deleteReply(editor, id, r.key) } : {})} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <div className="relative border-t border-line p-2">
        {matches.length > 0 && (
          <div className="absolute bottom-full left-2 right-2 mb-1 overflow-hidden rounded-xl border border-line bg-paper shadow-xl">
            {matches.map((n, i) => (
              <button key={n} type="button" onMouseDown={(e) => (e.preventDefault(), complete(n))} className={`block w-full px-3 py-1.5 text-left text-[13px] font-semibold ${i === pick ? "bg-accent/15 text-accent" : "hover:bg-hover"}`}>
                @{n}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            autoFocus
            rows={1}
            onChange={(e) => {
              setDraft(e.target.value.slice(0, 2000));
              setPick(0);
            }}
            onKeyDown={(e) => {
              if (matches.length > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                e.preventDefault();
                setPick((pick + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
              } else if (matches.length > 0 && (e.key === "Tab" || e.key === "Enter")) {
                e.preventDefault();
                const name = matches[pick];
                if (name) complete(name);
              } else if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              } else if (e.key === "Escape") editor.select([]);
            }}
            placeholder="Reply… type @ to mention"
            className="max-h-28 min-h-9 flex-1 resize-none rounded-xl border border-line bg-field px-3 py-2 text-[13px] outline-none focus:border-accent"
          />
          <button type="button" onClick={send} disabled={!draft.trim()} className="h-9 rounded-xl bg-accent px-3 text-[12px] font-bold text-white disabled:opacity-40">
            Send
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function Message({ author, color, text, at, names, onDelete }: { author: string; color: number; text: string; at: number; names: readonly string[]; onDelete?: () => void }) {
  return (
    <div className="group flex gap-2">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-bold text-white" style={{ background: hex(color) }}>
        {author.slice(0, 1).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[12px] font-bold">{author}</span>
          <span className="text-[11px] text-muted">{ago(at)}</span>
          {onDelete && (
            <button type="button" onClick={onDelete} className="ml-auto text-[11px] text-muted opacity-0 hover:text-[#ff5c5c] group-hover:opacity-100">
              Delete
            </button>
          )}
        </div>
        <p className="whitespace-pre-wrap break-words text-[13px] leading-[18px]">
          <Rich text={text} names={names} />
        </p>
      </div>
    </div>
  );
}

/**
 * All threads on the board, with filters (open / resolved / mentioning me), and a toast
 * when someone @mentions you while you're here.
 */
export function CommentsInbox({ editor }: { editor: Editor | null }) {
  const open = useUiStore((s) => s.commentsOpen);
  const version = useSceneVersion(editor, 400);
  const [filter, setFilter] = useState<"open" | "mine" | "resolved">("open");
  const seen = useRef<Set<string> | undefined>(undefined);
  const all = useMemo(() => (editor ? threads(editor) : []), [editor, version]);
  // Toast new mentions of me (not ones that were already here when I arrived).
  useEffect(() => {
    if (!editor) return;
    const me = editor.me;
    const keys = all.flatMap((t) => t.replies.filter((r) => r.by !== me.id && mentions(r.text, me.name)).map((r) => ({ key: `${t.view.id}/${r.key}`, r })));
    if (!seen.current) {
      seen.current = new Set(keys.map((k) => k.key));
      return;
    }
    for (const { key, r } of keys) {
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      useUiStore.getState().setNotice(`💬 ${r.author} mentioned you: “${r.text.slice(0, 80)}”`);
    }
  }, [all, editor]);
  if (!editor) return null;
  const me = editor.me;
  const involvesMe = (t: (typeof all)[number]): boolean => mentions(t.view.label ?? "", me.name) || t.replies.some((r) => mentions(r.text, me.name));
  const shown = all.filter((t) => (filter === "resolved" ? t.resolved : filter === "mine" ? !t.resolved && involvesMe(t) : !t.resolved));
  const names = mentionable(editor);
  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ x: 340, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 340, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 34 }}
          className="fixed bottom-3 right-3 top-16 z-40 flex w-[330px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-line bg-paper text-ink shadow-2xl"
        >
          <div className="flex items-center justify-between px-4 pb-2 pt-3">
            <h2 className="text-[15px] font-bold">Comments</h2>
            <button type="button" onClick={() => useUiStore.getState().setCommentsOpen(false)} className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-hover">
              ✕
            </button>
          </div>
          <div className="flex gap-1 px-3 pb-2">
            {(
              [
                ["open", "Open"],
                ["mine", "@ Me"],
                ["resolved", "Resolved"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setFilter(k)} className={`rounded-full px-3 py-1 text-[12px] font-semibold ${filter === k ? "bg-accent text-white" : "bg-hover text-muted"}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-3">
            {shown.length === 0 && <p className="px-2 py-8 text-center text-[13px] text-muted">{filter === "mine" ? "Nobody has mentioned you yet." : "No comments here. Press C and click anywhere to start a thread."}</p>}
            {shown.map((t) => (
              <button
                key={t.view.id}
                type="button"
                onClick={() => {
                  editor.select([t.view.id]);
                  editor.zoomToSelection();
                }}
                className="block w-full rounded-xl border border-line p-3 text-left hover:border-accent"
              >
                <div className="mb-1 flex items-center gap-2 text-[12px]">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: hex(t.view.fill) }} />
                  <span className="font-bold">{t.view.author ?? "Someone"}</span>
                  <span className="ml-auto text-muted">
                    {t.replies.length > 0 ? `💬 ${t.replies.length}` : ""} {t.resolved ? "✓" : ""}
                  </span>
                </div>
                <p className="line-clamp-2 text-[13px]">
                  <Rich text={t.view.label ?? ""} names={names} />
                </p>
                {t.replies.length > 0 && (
                  <p className="mt-1 line-clamp-1 text-[12px] text-muted">
                    ↳ {t.replies[t.replies.length - 1]?.author}: {t.replies[t.replies.length - 1]?.text}
                  </p>
                )}
              </button>
            ))}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
