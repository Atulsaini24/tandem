import { create } from "zustand";
import type { NodeId } from "@canvas/doc";
import type { SyncStatus } from "@canvas/sync";
import { applyTheme, loadPreference, resolveTheme, savePreference, type Theme, type ThemePreference } from "../canvas/theme";

export type Tool = "select" | "hand" | "rect" | "ellipse" | "diamond" | "text" | "note" | "arrow" | "pen" | "frame" | "comment";

export interface AiUiState {
  readonly status: "idle" | "thinking" | "writing" | "done" | "error" | "cancelled";
  readonly mode?: "generate" | "organize" | "diagram" | "insight";
  /** Insight mode: the summary, shown in the panel too. */
  readonly summary?: string;
  /** Cards placed so far in this run. */
  readonly items: number;
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly message?: string;
  readonly tokensPerSecond?: number;
}

export interface Stats {
  readonly fps: number;
  /** 95th-percentile frame time over the last ~2s, in ms. */
  readonly p95: number;
  readonly shapes: number;
  readonly zoom: number;
  readonly engineMs: number;
}

export interface BenchResult {
  /**
   * Main-thread time per frame: our code + Pixi's render submission. This is what the
   * app controls. avgFps/p95FrameMs also include the display's refresh rate and the
   * browser's scheduling, which the app does not control.
   */
  readonly workMedianMs: number;
  readonly workP95Ms: number;
  readonly frames: number;
  readonly avgFps: number;
  readonly p95FrameMs: number;
  readonly worstFrameMs: number;
  readonly slowFrames: number;
  readonly shapes: number;
  readonly movedPerFrame: number;
}

export interface SyncUiState {
  readonly status: SyncStatus;
  readonly pending: number;
  readonly error?: string;
  /** What the user asked for with the online/offline toggle. */
  readonly wantOnline: boolean;
  /** Signed in with a viewer token: everything is visible, nothing is editable. */
  readonly readOnly: boolean;
  readonly docId: string;
}

/** Time travel: which version is on screen. Undefined = the live document. */
export interface HistoryUiState {
  /** Server seq being previewed. */
  readonly at: number;
  /** Total versions available (the server's head when last fetched). */
  readonly head: number;
  readonly loading: boolean;
  readonly error?: string;
}

export interface Person {
  readonly clientId: string;
  readonly name: string;
  readonly color: number;
}

interface UiState {
  readonly tool: Tool;
  /** The board's synced name. */
  readonly title: string | undefined;
  /** Opened from a view-only share link: editing is off in this tab. */
  readonly viewMode: boolean;
  /** The person whose view we're following (their pan and zoom drive ours). */
  readonly following: string | undefined;
  readonly paletteOpen: boolean;
  /** Cursor chat: what you're typing next to your cursor (undefined = closed). */
  readonly chat: string | undefined;
  /** Fill for new shapes (the style bar's last pick). */
  readonly fill: number;
  /** Dot voting is on: clicking a shape toggles your vote. */
  readonly voting: boolean;
  /** The synced countdown (from board meta). */
  readonly timer: { readonly end: number; readonly total: number; readonly paused: number };
  /** Present mode: the frame ids in slide order and which one is showing. */
  readonly presenting: { readonly slides: readonly NodeId[]; readonly index: number } | undefined;
  readonly laser: boolean;
  /** I'm asking everyone to follow me. */
  readonly spotlight: boolean;
  /** Someone else is spotlighting (their client id), and we're following them. */
  readonly spotlightBy: string | undefined;
  /** Radial menu at a screen point, for a shape or for empty canvas. */
  readonly radial: { readonly x: number; readonly y: number; readonly target: NodeId | undefined } | undefined;
  /** The simulated team (bots) is running. */
  readonly crowd: boolean;
  readonly ritualsOpen: boolean;
  setVoting(voting: boolean): void;
  setTimer(timer: { end: number; total: number; paused: number }): void;
  setPresenting(presenting: { slides: readonly NodeId[]; index: number } | undefined): void;
  setLaser(laser: boolean): void;
  setSpotlight(spotlight: boolean): void;
  setSpotlightBy(clientId: string | undefined): void;
  setRadial(radial: { x: number; y: number; target: NodeId | undefined } | undefined): void;
  setCrowd(crowd: boolean): void;
  setRitualsOpen(open: boolean): void;
  /** Keys typed after "start editing" but before the text box appeared (not lost). */
  readonly editBuffer: string;
  setEditBuffer(editBuffer: string): void;
  setTitle(title: string | undefined): void;
  setViewMode(viewMode: boolean): void;
  setFollowing(clientId: string | undefined): void;
  setPaletteOpen(open: boolean): void;
  setChat(chat: string | undefined): void;
  setFill(fill: number): void;
  readonly selection: ReadonlySet<NodeId>;
  readonly stats: Stats;
  readonly bench: BenchResult | "running" | undefined;
  readonly sync: SyncUiState;
  /** Other people on this document (roster only; cursors are drawn by the canvas). */
  readonly peers: readonly Person[];
  readonly me: Omit<Person, "clientId"> | undefined;
  /** A transient message, e.g. "Restored 3 unsynced edits". */
  readonly notice: string | undefined;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly history: HistoryUiState | undefined;
  /** The shape whose label is being edited. */
  readonly editing: NodeId | undefined;
  readonly ai: AiUiState;
  readonly aiOpen: boolean;
  readonly themePreference: ThemePreference;
  readonly theme: Theme;
  setTheme(preference: ThemePreference): void;
  setEditing(id: NodeId | undefined): void;
  setAi(ai: Partial<AiUiState> & Pick<AiUiState, "status">): void;
  setAiOpen(open: boolean): void;
  setUndo(state: { canUndo: boolean; canRedo: boolean }): void;
  setHistory(history: HistoryUiState | undefined): void;
  setTool(tool: Tool): void;
  setSelection(selection: ReadonlySet<NodeId>): void;
  setStats(stats: Partial<Stats>): void;
  setBench(bench: BenchResult | "running" | undefined): void;
  setSync(sync: Partial<SyncUiState>): void;
  setPeers(peers: readonly Person[]): void;
  setMe(me: Omit<Person, "clientId">): void;
  setNotice(notice: string | undefined): void;
}

/**
 * UI state only. Document state lives in the engine worker (source of truth) and
 * its optimistic mirror, Scene. The canvas reads this store with getState() every
 * frame instead of subscribing, so React never re-renders on canvas activity.
 */
export const useUiStore = create<UiState>()((set) => ({
  tool: "select",
  title: undefined,
  viewMode: false,
  following: undefined,
  paletteOpen: false,
  chat: undefined,
  fill: 0x2f63ff,
  editBuffer: "",
  voting: false,
  timer: { end: 0, total: 0, paused: 0 },
  presenting: undefined,
  laser: false,
  spotlight: false,
  spotlightBy: undefined,
  radial: undefined,
  crowd: false,
  ritualsOpen: false,
  setVoting: (voting) => set({ voting }),
  setTimer: (timer) => set({ timer }),
  setPresenting: (presenting) => set({ presenting }),
  setLaser: (laser) => set({ laser }),
  setSpotlight: (spotlight) => set({ spotlight }),
  setSpotlightBy: (spotlightBy) => set({ spotlightBy }),
  setRadial: (radial) => set({ radial }),
  setCrowd: (crowd) => set({ crowd }),
  setRitualsOpen: (ritualsOpen) => set({ ritualsOpen }),
  setEditBuffer: (editBuffer) => set({ editBuffer }),
  setTitle: (title) => set({ title }),
  setViewMode: (viewMode) => set({ viewMode }),
  setFollowing: (following) => set({ following }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setChat: (chat) => set({ chat }),
  setFill: (fill) => set({ fill }),
  selection: new Set(),
  stats: { fps: 0, p95: 0, shapes: 0, zoom: 1, engineMs: 0 },
  bench: undefined,
  sync: { status: "offline", pending: 0, wantOnline: true, docId: "default", readOnly: false },
  peers: [],
  me: undefined,
  notice: undefined,
  canUndo: false,
  canRedo: false,
  history: undefined,
  editing: undefined,
  ai: { status: "idle", items: 0 },
  aiOpen: false,
  themePreference: loadPreference(),
  theme: resolveTheme(loadPreference()),
  setTheme: (themePreference) => {
    savePreference(themePreference);
    const theme = resolveTheme(themePreference);
    applyTheme(theme);
    set({ themePreference, theme });
  },
  setEditing: (editing) => set({ editing, editBuffer: "" }),
  setAi: (ai) => set((state) => ({ ai: { ...state.ai, ...ai } })),
  setAiOpen: (aiOpen) => set({ aiOpen }),
  setUndo: ({ canUndo, canRedo }) => set({ canUndo, canRedo }),
  setHistory: (history) => set({ history }),
  setTool: (tool) => set({ tool }),
  setPeers: (peers) => set({ peers }),
  setMe: (me) => set({ me }),
  setNotice: (notice) => set({ notice }),
  setSync: (sync) => set((state) => ({ sync: { ...state.sync, ...sync } })),
  setSelection: (selection) => set({ selection }),
  setStats: (stats) => set((state) => ({ stats: { ...state.stats, ...stats } })),
  setBench: (bench) => set({ bench }),
}));
