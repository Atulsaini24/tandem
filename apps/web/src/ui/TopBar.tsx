import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { Editor } from "../canvas/editor";
import { linkProps } from "../router";
import { useUiStore } from "../state/ui-store";
import { Icon, IconButton, Logo, hexColor, initials, panel, spring } from "./kit";
import { ThemeToggle } from "./ThemeToggle";

function describe(status: string, pending: number, wantOnline: boolean, readOnly: boolean, error?: string) {
  if (error) return { label: "Rejected", dot: "bg-bad", pulse: false };
  if (!wantOnline) return { label: pending > 0 ? `Offline · ${pending} queued` : "Offline", dot: "bg-muted", pulse: false };
  if (status === "online" && readOnly) return { label: "View only", dot: "bg-accent", pulse: false };
  if (status === "online" && pending === 0) return { label: "Synced", dot: "bg-good", pulse: false };
  if (status === "online") return { label: `Syncing ${pending}`, dot: "bg-accent", pulse: true };
  return { label: pending > 0 ? `Reconnecting · ${pending}` : "Reconnecting", dot: "bg-warn", pulse: true };
}

/** Sync status; click to go offline/online (edits queue locally and merge on reconnect). */
function SyncButton({ editor }: { editor: Editor | null }) {
  const sync = useUiStore((s) => s.sync);
  const view = describe(sync.status, sync.pending, sync.wantOnline, sync.readOnly, sync.error);
  return (
    <motion.button
      type="button"
      disabled={!editor}
      onClick={() => editor?.setOnline(!sync.wantOnline)}
      title={sync.error ?? (sync.wantOnline ? "Click to work offline — edits are kept and merge when you're back" : "Click to go back online")}
      whileTap={{ scale: 0.96 }}
      className="flex h-9 items-center gap-2 rounded-xl px-2.5 text-[12px] font-semibold text-ink hover:bg-hover"
    >
      <span className="relative flex h-2 w-2">
        {view.pulse && (
          <motion.span
            className={`absolute inset-0 rounded-full ${view.dot}`}
            animate={{ scale: [1, 2.4], opacity: [0.6, 0] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: "easeOut" }}
          />
        )}
        <span className={`relative h-2 w-2 rounded-full ${view.dot}`} />
      </span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={view.label} initial={{ y: 6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -6, opacity: 0 }} transition={spring} className="hidden sm:inline">
          {view.label}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}

function Title({ editor }: { editor: Editor | null }) {
  const title = useUiStore((s) => s.title);
  const locked = useUiStore((s) => s.sync.readOnly || s.viewMode);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);
  useEffect(() => {
    document.title = `${title ?? "Untitled board"} · Tandem`;
  }, [title]);
  const commit = (): void => {
    setEditing(false);
    if (value.trim() && value.trim() !== title) editor?.setTitle(value);
  };
  if (editing) {
    return (
      <input
        ref={ref}
        value={value}
        maxLength={120}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        aria-label="Board name"
        className="h-9 w-56 rounded-xl border border-accent bg-field px-2.5 text-[14px] font-semibold text-ink outline-none sm:w-72"
      />
    );
  }
  return (
    <button
      type="button"
      disabled={locked || !editor}
      onClick={() => {
        setValue(title ?? "Untitled board");
        setEditing(true);
      }}
      title={locked ? undefined : "Rename board"}
      className="h-9 max-w-[38vw] truncate rounded-xl px-2.5 text-left text-[14px] font-semibold text-ink hover:bg-hover disabled:hover:bg-transparent"
    >
      {title ?? "Untitled board"}
    </button>
  );
}

/** Who's here. Click someone to follow their view; click again (or move) to stop. */
function Avatars({ editor }: { editor: Editor | null }) {
  const peers = useUiStore((s) => s.peers);
  const me = useUiStore((s) => s.me);
  const following = useUiStore((s) => s.following);
  const shown = peers.slice(0, 5);
  const extra = peers.length - shown.length;
  return (
    <div className="flex items-center pl-1 pr-2" aria-label={`${peers.length + 1} people here`}>
      <AnimatePresence initial={false}>
        {me && (
          <motion.div
            key="me"
            layout
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            title={`${me.name} (you)`}
            className="grid h-8 w-8 place-items-center rounded-full border-2 border-paper text-[10px] font-bold text-white"
            style={{ backgroundColor: hexColor(me.color) }}
          >
            {initials(me.name)}
          </motion.div>
        )}
        {shown.map((person) => {
          const active = following === person.clientId;
          return (
            <motion.button
              type="button"
              key={person.clientId}
              layout
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              whileHover={{ y: -2 }}
              transition={spring}
              onClick={() => editor?.follow(person.clientId)}
              title={active ? `Following ${person.name} — click to stop` : `Follow ${person.name}`}
              className="-ml-2 grid h-8 w-8 place-items-center rounded-full border-2 border-paper text-[10px] font-bold text-white"
              style={{ backgroundColor: hexColor(person.color), boxShadow: active ? `0 0 0 2px ${hexColor(person.color)}` : undefined }}
            >
              {initials(person.name)}
            </motion.button>
          );
        })}
        {extra > 0 && (
          <motion.div key="extra" layout className="-ml-2 grid h-8 w-8 place-items-center rounded-full border-2 border-paper bg-ink text-[10px] font-bold text-paper">
            +{extra}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ExportMenu({ editor }: { editor: Editor | null }) {
  const [open, setOpen] = useState(false);
  const selected = useUiStore((s) => s.selection.size);
  const [busy, setBusy] = useState(false);
  const run = (fn: () => void | Promise<void>): void => {
    setOpen(false);
    setBusy(true);
    void Promise.resolve(fn())
      .catch((error: unknown) => useUiStore.getState().setNotice(`Export failed: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => setBusy(false));
  };
  return (
    <div className="relative">
      <IconButton icon="download" title="Export" onClick={() => setOpen(!open)} active={open} disabled={!editor || busy} />
      <AnimatePresence>
        {open && editor && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }}
            transition={spring}
            className={`absolute right-0 top-12 w-60 p-1.5 ${panel}`}
          >
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-[0.09em] text-muted">
              Export {selected > 0 ? `${selected} selected` : "whole board"}
            </p>
            {[
              { label: "PNG image", hint: "2× resolution", fn: () => editor.exportPng() },
              { label: "SVG vector", hint: "Scales forever", fn: () => editor.exportSvg() },
              { label: "PDF", hint: "Print dialog", fn: () => editor.exportPdf() },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => run(item.fn)}
                className="flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-[13px] font-semibold text-ink hover:bg-hover"
              >
                {item.label}
                <span className="text-[11px] font-medium text-muted">{item.hint}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function TopBar({ editor, onShare }: { editor: Editor | null; onShare: () => void }) {
  const viewMode = useUiStore((s) => s.viewMode || s.sync.readOnly);
  const following = useUiStore((s) => s.following);
  const peers = useUiStore((s) => s.peers);
  const followed = peers.find((p) => p.clientId === following);
  return (
    <>
      <motion.div
        initial={{ y: -24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={spring}
        className={`pointer-events-auto absolute left-4 top-4 flex items-center gap-1 p-1.5 ${panel}`}
      >
        <a {...linkProps("/boards")} title="All boards" className="grid h-9 w-9 place-items-center rounded-xl hover:bg-hover">
          <Logo className="h-6 w-6" />
        </a>
        <span className="h-5 w-px bg-line" />
        <Title editor={editor} />
        {viewMode && <span className="rounded-lg bg-accent/15 px-2 py-1 text-[11px] font-bold text-accent">View only</span>}
        <SyncButton editor={editor} />
      </motion.div>
      <motion.div
        initial={{ y: -24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ ...spring, delay: 0.05 }}
        className={`pointer-events-auto absolute right-4 top-4 flex items-center gap-1 p-1.5 ${panel}`}
      >
        <Avatars editor={editor} />
        <motion.button
          type="button"
          onClick={onShare}
          disabled={!editor}
          whileTap={{ scale: 0.96 }}
          className="flex h-9 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-[13px] font-semibold text-white shadow-[0_6px_16px_rgba(47,99,255,0.35)] hover:brightness-110 disabled:opacity-40"
        >
          <Icon name="share" className="h-4 w-4" />
          Share
        </motion.button>
        <ExportMenu editor={editor} />
        <ThemeToggle compact />
      </motion.div>
      <AnimatePresence>
        {followed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-0 border-[3px]"
            style={{ borderColor: hexColor(followed.color) }}
          >
            <span className="absolute left-1/2 top-0 -translate-x-1/2 rounded-b-xl px-3 py-1 text-[12px] font-bold text-white" style={{ backgroundColor: hexColor(followed.color) }}>
              Following {followed.name}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
