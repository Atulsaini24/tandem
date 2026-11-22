import { AnimatePresence, motion } from "motion/react";
import type { Editor } from "../canvas/editor";
import { useUiStore } from "../state/ui-store";
import { Avatars } from "./Presence";

const spring = { type: "spring", stiffness: 420, damping: 34 } as const;

function describe(status: string, pending: number, wantOnline: boolean, error?: string) {
  if (error) return { label: "Rejected", dot: "bg-bad", pulse: false };
  if (!wantOnline) return { label: pending > 0 ? `Offline · ${pending} queued` : "Offline", dot: "bg-muted", pulse: false };
  if (status === "online" && pending === 0) return { label: "Synced", dot: "bg-good", pulse: false };
  if (status === "online") return { label: `Syncing ${pending}`, dot: "bg-accent", pulse: true };
  return { label: pending > 0 ? `Reconnecting · ${pending} queued` : "Reconnecting", dot: "bg-warn", pulse: true };
}

/**
 * Live sync status, and the offline toggle used to demo offline editing:
 * go offline, edit in two tabs, come back, watch them converge.
 */
export function SyncPill({ editor }: { editor: Editor | null }) {
  const sync = useUiStore((s) => s.sync);
  const view = describe(sync.status, sync.pending, sync.wantOnline, sync.error);
  return (
    <div className="pointer-events-none absolute right-4 top-4 flex items-center gap-3">
      <Avatars />
      <motion.button
        type="button"
        disabled={!editor}
        onClick={() => editor?.setOnline(!sync.wantOnline)}
        title={sync.error ?? (sync.wantOnline ? "Click to go offline" : "Click to go back online")}
        initial={{ y: -28, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.97 }}
        transition={{ ...spring, delay: 0.15 }}
        className="pointer-events-auto flex h-[52px] items-center gap-2.5 rounded-full border border-black/10 bg-paper/90 pl-4 pr-5 shadow-[0_12px_32px_rgba(25,29,37,0.10)] backdrop-blur-md"
      >
        <span className="relative flex h-2.5 w-2.5">
          {view.pulse && (
            <motion.span
              className={`absolute inset-0 rounded-full ${view.dot}`}
              animate={{ scale: [1, 2.4], opacity: [0.6, 0] }}
              transition={{ duration: 1.1, repeat: Infinity, ease: "easeOut" }}
            />
          )}
          <span className={`relative h-2.5 w-2.5 rounded-full transition-colors ${view.dot}`} />
        </span>
        <span className="flex flex-col items-start leading-tight">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={view.label}
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -8, opacity: 0 }}
              transition={spring}
              className="text-[13px] font-semibold text-ink"
            >
              {view.label}
            </motion.span>
          </AnimatePresence>
          <span className="font-mono text-[10px] text-muted">doc: {sync.docId}</span>
        </span>
      </motion.button>
    </div>
  );
}
