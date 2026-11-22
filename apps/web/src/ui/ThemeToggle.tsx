import { AnimatePresence, motion } from "motion/react";
import { useUiStore } from "../state/ui-store";
import type { ThemePreference } from "../canvas/theme";

const NEXT: Record<ThemePreference, ThemePreference> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<ThemePreference, string> = { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" };

const ICONS: Record<ThemePreference, string> = {
  // half-filled circle = follow the system
  system: "M12 3a9 9 0 1 0 0 18V3z M12 3a9 9 0 0 1 0 18",
  light: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1",
  dark: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
};

/** Cycles system → light → dark. The icon swaps with a quick spin. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const preference = useUiStore((s) => s.themePreference);
  const setTheme = useUiStore((s) => s.setTheme);
  return (
    <motion.button
      type="button"
      onClick={() => setTheme(NEXT[preference])}
      title={`${LABEL[preference]} (click to change)`}
      aria-label={LABEL[preference]}
      whileTap={{ scale: 0.9 }}
      className={
        compact
          ? "pointer-events-auto grid h-9 w-9 place-items-center rounded-xl text-ink hover:bg-hover"
          : "pointer-events-auto grid h-11 w-11 place-items-center rounded-full border border-edge bg-paper/80 text-ink backdrop-blur-md hover:bg-hover"
      }
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.svg
          key={preference}
          viewBox="0 0 24 24"
          initial={{ rotate: -90, opacity: 0, scale: 0.6 }}
          animate={{ rotate: 0, opacity: 1, scale: 1 }}
          exit={{ rotate: 90, opacity: 0, scale: 0.6 }}
          transition={{ type: "spring", stiffness: 420, damping: 28 }}
          className="h-[18px] w-[18px] stroke-ink"
          fill={preference === "system" ? "currentColor" : "none"}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={ICONS[preference]} fill={preference === "dark" ? "currentColor" : undefined} />
        </motion.svg>
      </AnimatePresence>
    </motion.button>
  );
}
