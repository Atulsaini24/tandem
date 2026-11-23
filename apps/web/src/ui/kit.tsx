import { motion } from "motion/react";
import type { ReactNode } from "react";

export const spring = { type: "spring", stiffness: 420, damping: 34 } as const;
export const softSpring = { type: "spring", stiffness: 260, damping: 30 } as const;

/** Floating glass panel used for every piece of chrome on the board. */
export const panel =
  "rounded-2xl border border-white/60 bg-paper/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_18px_44px_rgba(25,29,37,0.14)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_18px_44px_rgba(0,0,0,0.45)]";

export const MOD = typeof navigator !== "undefined" && navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl+";

export const ICONS = {
  select: "M5 3l14 8.5-6.2 1.3 3.7 6.4-2.6 1.5-3.7-6.4L5.5 18z",
  hand: "M8 13V5.5a1.5 1.5 0 0 1 3 0V12m0-6.5v-1a1.5 1.5 0 0 1 3 0V12m0-5.5a1.5 1.5 0 0 1 3 0V12m0-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-2c-2.2 0-3.6-.9-4.8-2.4L3.6 15a1.6 1.6 0 0 1 2.4-2.1L8 15",
  rect: "M4 6h16v12H4z",
  ellipse: "M12 5.5c4.4 0 8 2.9 8 6.5s-3.6 6.5-8 6.5S4 15.6 4 12s3.6-6.5 8-6.5z",
  diamond: "M12 3l9 9-9 9-9-9z",
  text: "M5 6V4h14v2M12 4v16M9 20h6",
  note: "M5 4h14v11l-5 5H5zM14 20v-5h5",
  arrow: "M5 19L19 5M10 5h9v9",
  pen: "M4 20c3-1 4-4 6.5-6.5L17 7l-2-2-6.5 6.5C6 14 5 15 4 20zM15 5l4 4",
  frame: "M7 3v18M17 3v18M3 7h18M3 17h18",
  comment: "M5 5h14v10H10l-5 4z",
  undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  redo: "m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 3",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  share: "M16 6l-4-4-4 4M12 2v13M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7",
  download: "M12 3v12M7 10l5 5 5-5M5 21h14",
  trash: "M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3",
  copy: "M8 8h12v12H8zM4 16V4h12",
  front: "M8 8h12v12H8z M4 4h10v2M4 4v10h2",
  back: "M4 4h12v12H4z M18 8h2v12H8v-2",
  group: "M4 4h6M4 4v6M20 4h-6M20 4v6M4 20h6M4 20v-6M20 20h-6M20 20v-6",
  alignLeft: "M4 3v18M8 7h10v4H8zM8 14h6v4H8z",
  alignCenter: "M12 3v18M6 7h12v4H6zM8 14h8v4H8z",
  alignRight: "M20 3v18M6 7h10v4H6zM10 14h6v4h-6z",
  alignTop: "M3 4h18M7 8h4v10H7zM14 8h4v6h-4z",
  alignMiddle: "M3 12h18M7 6h4v12H7zM14 8h4v8h-4z",
  alignBottom: "M3 20h18M7 6h4v10H7zM14 10h4v6h-4z",
  distributeX: "M4 4v16M20 4v16M10 8h4v8h-4z",
  distributeY: "M4 4h16M4 20h16M8 10h8v4H8z",
  rotate: "M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  smile: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8.5 14.5s1.2 2 3.5 2 3.5-2 3.5-2M9 9.5h.01M15 9.5h.01",
  chat: "M4 5h16v11H9l-5 4z",
  back2: "M15 18l-6-6 6-6",
  command: "M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  check: "M5 12l5 5 9-10",
  close: "M6 6l12 12M18 6L6 18",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z",
  map: "M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14",
  chart: "M4 20V10M10 20V4M16 20v-7M21 20H3",
  cube: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5",
  slides: "M3 5h18v12H3zM8 21h8M12 17v4",
  panel: "M4 4h16v16H4zM9 4v16",
  inspect: "M4 4h16v16H4zM15 4v16",
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, className = "h-[18px] w-[18px]", filled = false }: { name: IconName; className?: string; filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} ${filled ? "fill-current" : "fill-none"} stroke-current`} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

export function IconButton({
  icon,
  title,
  onClick,
  disabled,
  active,
  className = "",
  children,
}: {
  icon?: IconName;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <motion.button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      whileTap={disabled ? {} : { scale: 0.9 }}
      transition={spring}
      className={`grid h-9 min-w-9 place-items-center rounded-xl px-2 text-ink transition-colors hover:bg-hover disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent ${active ? "bg-ink text-paper hover:bg-ink" : ""} ${className}`}
    >
      {icon ? <Icon name={icon} /> : children}
    </motion.button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-line bg-field px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted">{children}</kbd>;
}

export const hexColor = (color: number): string => `#${color.toString(16).padStart(6, "0")}`;

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** The product mark: two overlapping tiles. */
export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect x="3" y="3" width="17" height="17" rx="4.5" fill="#2f63ff" />
      <rect x="12" y="12" width="17" height="17" rx="4.5" fill="#ff8a5b" fillOpacity="0.92" />
    </svg>
  );
}
