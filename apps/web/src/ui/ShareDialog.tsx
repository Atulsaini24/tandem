import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Editor } from "../canvas/editor";
import { useUiStore } from "../state/ui-store";
import { Icon, panel, spring } from "./kit";

type Access = "editor" | "viewer";

interface Links {
  readonly editor: string;
  readonly viewer: string;
  /** True when the server checks tokens, so a view link really can't edit. */
  readonly enforced: boolean;
}

function syncHttpUrl(): string {
  const configured = import.meta.env.VITE_SYNC_URL as string | undefined;
  if (configured) return configured.replace(/^ws/, "http");
  return `${location.protocol}//${location.hostname}:8787`;
}

/**
 * Builds the two links. With auth on (AUTH_SECRET on the server), the server mints a
 * token for each role, so a view link is read-only for real. On an open dev server the
 * view link sets mode=view, which locks this app's UI (a convenience, not security).
 */
async function buildLinks(docId: string): Promise<Links> {
  const base = `${location.origin}/b/${encodeURIComponent(docId)}`;
  const token = new URLSearchParams(location.search).get("token");
  const mint = async (role: Access): Promise<string | undefined> => {
    const response = await fetch(`${syncHttpUrl()}/share`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ docId, role, ...(token ? { token } : {}) }),
    });
    const body = (await response.json()) as { auth?: boolean; token?: string; error?: string };
    if (!response.ok) throw new Error(body.error ?? `server said ${response.status}`);
    return body.auth ? body.token : undefined;
  };
  try {
    const [editor, viewer] = await Promise.all([mint("editor"), mint("viewer")]);
    if (editor && viewer) {
      return { editor: `${base}?token=${encodeURIComponent(editor)}`, viewer: `${base}?mode=view&token=${encodeURIComponent(viewer)}`, enforced: true };
    }
  } catch {
    // Server unreachable or not allowed to mint: fall back to plain links.
  }
  return { editor: base, viewer: `${base}?mode=view`, enforced: false };
}

function LinkRow({ label, hint, url, icon }: { label: string; hint: string; url: string; icon: "eye" | "pen" }) {
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    void navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1_600);
      })
      .catch(() => useUiStore.getState().setNotice("Couldn't copy — select the link and copy it manually"));
  };
  return (
    <div className="rounded-2xl border border-line bg-field p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-canvas text-ink">
          <Icon name={icon} className="h-4 w-4" />
        </span>
        <div className="flex-1">
          <p className="text-[13px] font-bold text-ink">{label}</p>
          <p className="text-[11px] text-muted">{hint}</p>
        </div>
        <motion.button type="button" onClick={copy} whileTap={{ scale: 0.95 }} className={`flex h-8 items-center gap-1.5 rounded-xl px-3 text-[12px] font-bold transition-colors ${copied ? "bg-good text-white" : "bg-ink text-paper"}`}>
          <Icon name={copied ? "check" : "link"} className="h-3.5 w-3.5" />
          {copied ? "Copied" : "Copy link"}
        </motion.button>
      </div>
      <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="w-full truncate rounded-lg bg-canvas px-2.5 py-1.5 font-mono text-[11px] text-muted outline-none" />
    </div>
  );
}

export function ShareDialog({ editor, open, onClose }: { editor: Editor | null; open: boolean; onClose: () => void }) {
  const [links, setLinks] = useState<Links | undefined>();
  const docId = editor?.docId;
  useEffect(() => {
    if (!open || !docId) return;
    let alive = true;
    setLinks(undefined);
    void buildLinks(docId).then((l) => alive && setLinks(l));
    return () => {
      alive = false;
    };
  }, [open, docId]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div key="share" className="absolute inset-0 z-40 flex items-start justify-end bg-ink/10 p-4 pt-[72px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={onClose}>
          <motion.div
            role="dialog"
            aria-label="Share this board"
            initial={{ y: -10, scale: 0.97, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: -8, opacity: 0 }}
            transition={spring}
            onPointerDown={(e) => e.stopPropagation()}
            className={`w-[400px] max-w-full space-y-3 p-4 ${panel} bg-paper`}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-bold text-ink">Share this board</h2>
              <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-hover">
                <Icon name="close" className="h-4 w-4" />
              </button>
            </div>
            {!links && <div className="h-40 animate-pulse rounded-2xl bg-canvas" />}
            {links && (
              <>
                <LinkRow label="Can edit" hint="Anyone with this link can change the board" url={links.editor} icon="pen" />
                <LinkRow label="Can view" hint="Live, read-only: they see every change as it happens" url={links.viewer} icon="eye" />
                <p className="flex items-start gap-2 rounded-xl bg-canvas px-3 py-2 text-[11px] leading-relaxed text-muted">
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${links.enforced ? "bg-good" : "bg-warn"}`} />
                  {links.enforced
                    ? "Signed links: the sync server checks each token, so a view link can never edit."
                    : "This sync server runs without auth (dev mode), so the view link only locks the app. Start the server with AUTH_SECRET for signed, enforced links."}
                </p>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
