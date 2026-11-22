import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { useUiStore, type Person } from "../state/ui-store";

const spring = { type: "spring", stiffness: 480, damping: 32 } as const;
const hex = (color: number): string => `#${color.toString(16).padStart(6, "0")}`;
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

function Avatar({ person, you }: { person: Omit<Person, "clientId">; you?: boolean }) {
  return (
    <motion.div
      layout
      initial={{ scale: 0.4, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.4, opacity: 0 }}
      transition={spring}
      title={you ? `${person.name} (you)` : person.name}
      className="-ml-2 grid h-9 w-9 place-items-center rounded-full border-2 border-paper text-[11px] font-bold text-white shadow-[0_4px_12px_rgba(25,29,37,0.15)] first:ml-0"
      style={{ backgroundColor: hex(person.color) }}
    >
      {initials(person.name)}
    </motion.div>
  );
}

/** Who's on this document right now: you first, then everyone else as they join and leave. */
export function Avatars() {
  const peers = useUiStore((s) => s.peers);
  const me = useUiStore((s) => s.me);
  const shown = peers.slice(0, 5);
  const extra = peers.length - shown.length;
  return (
    <div className="pointer-events-auto flex items-center pr-1" aria-label={`${peers.length + 1} people here`}>
      <AnimatePresence initial={false}>
        {me && <Avatar key="me" person={me} you />}
        {shown.map((person) => (
          <Avatar key={person.clientId} person={person} />
        ))}
        {extra > 0 && (
          <motion.div
            key="extra"
            layout
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            className="-ml-2 grid h-9 w-9 place-items-center rounded-full border-2 border-paper bg-ink text-[11px] font-bold text-white"
          >
            +{extra}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A transient message under the toolbar, e.g. "Restored 3 unsynced edits". */
export function Notice() {
  const notice = useUiStore((s) => s.notice);
  const setNotice = useUiStore((s) => s.setNotice);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 5_000);
    return () => clearTimeout(timer);
  }, [notice, setNotice]);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-20 flex justify-center px-4">
      <AnimatePresence>
        {notice && (
          <motion.div
            key={notice}
            role="status"
            initial={{ y: -16, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -10, opacity: 0 }}
            transition={spring}
            className="rounded-full bg-ink px-5 py-3 text-[13px] font-semibold text-white shadow-[0_12px_32px_rgba(17,19,24,0.25)]"
          >
            {notice}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
