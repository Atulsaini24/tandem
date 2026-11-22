/**
 * Light / dark theme. The preference ("system" by default) is a per-viewer convenience
 * in localStorage. The resolved theme lives on <html data-theme>, which drives both the
 * CSS tokens (styles.css) and the canvas colors below.
 *
 * index.html applies the same logic inline before the app loads, so there's no flash of
 * the wrong theme on startup.
 */
export type ThemePreference = "system" | "light" | "dark";
export type Theme = "light" | "dark";

export interface CanvasTheme {
  readonly name: Theme;
  readonly background: number;
  readonly gridDot: number;
  readonly selection: number;
  /** Text and lines drawn "in ink" (text shapes, dark arrows). */
  readonly ink: number;
  readonly paper: number;
  readonly muted: number;
  readonly line: number;
  /** Alignment guides while snapping. */
  readonly guide: number;
  readonly shadow: number;
}

export const CANVAS_THEMES: Readonly<Record<Theme, CanvasTheme>> = {
  light: {
    name: "light",
    background: 0xf3f0e8,
    gridDot: 0xc9c4b8,
    selection: 0x2f63ff,
    ink: 0x111318,
    paper: 0xfbfaf6,
    muted: 0x6c6f76,
    line: 0xd8d4ca,
    guide: 0xff3d8b,
    shadow: 0x3a3226,
  },
  dark: {
    name: "dark",
    background: 0x111317,
    gridDot: 0x30343c,
    selection: 0x6b8dff,
    ink: 0xeceae4,
    paper: 0x1b1e24,
    muted: 0x9a9ea6,
    line: 0x33373f,
    guide: 0xff5c9e,
    shadow: 0x000000,
  },
};

const KEY = "canvas:theme";

export function loadPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function savePreference(preference: ThemePreference): void {
  try {
    if (preference === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, preference);
  } catch {
    // storage blocked: the choice just won't survive a reload
  }
}

const systemDark = (): boolean =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;

export function resolveTheme(preference: ThemePreference): Theme {
  if (preference !== "system") return preference;
  return systemDark() ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#111317" : "#f3f0e8");
}

/** Call `onChange` when the system theme flips (only matters while the preference is "system"). */
export function watchSystemTheme(onChange: () => void): () => void {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

// --- colors as drawn ------------------------------------------------------------

export const luminance = (fill: number): number => 0.299 * ((fill >> 16) & 0xff) + 0.587 * ((fill >> 8) & 0xff) + 0.114 * (fill & 0xff);

/** Dark text on light fills, white on dark ones (perceived luminance). */
export function labelColor(fill: number): number {
  return luminance(fill) > 165 ? 0x111318 : 0xffffff;
}

/**
 * The color a fill is DRAWN with. Fills are shared document data and never change with the
 * viewer's theme, but a near-black shape on the dark canvas would vanish, so in dark mode
 * very dark fills are shown as a lifted slate. Display only: nothing is written back.
 */
export function displayFill(fill: number, theme: CanvasTheme): number {
  return theme.name === "dark" && luminance(fill) < 40 ? 0x3a3f4a : fill;
}

/** Lines and ink (arrows, pen, text): near-black ink flips to near-white in dark mode. */
export function inkColor(fill: number, theme: CanvasTheme): number {
  return theme.name === "dark" && luminance(fill) < 60 ? theme.ink : fill;
}

export const hex = (color: number): string => `#${color.toString(16).padStart(6, "0")}`;
