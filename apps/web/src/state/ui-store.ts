import { create } from "zustand";
import type { NodeId } from "@canvas/doc";
import type { SyncStatus } from "@canvas/sync";

export type Tool = "select" | "rect" | "ellipse";

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
  readonly docId: string;
}

interface UiState {
  readonly tool: Tool;
  readonly selection: ReadonlySet<NodeId>;
  readonly stats: Stats;
  readonly bench: BenchResult | "running" | undefined;
  readonly sync: SyncUiState;
  setTool(tool: Tool): void;
  setSelection(selection: ReadonlySet<NodeId>): void;
  setStats(stats: Partial<Stats>): void;
  setBench(bench: BenchResult | "running" | undefined): void;
  setSync(sync: Partial<SyncUiState>): void;
}

/**
 * UI state only. Document state lives in the engine worker (source of truth) and
 * its optimistic mirror, Scene. The canvas reads this store with getState() every
 * frame instead of subscribing, so React never re-renders on canvas activity.
 */
export const useUiStore = create<UiState>()((set) => ({
  tool: "select",
  selection: new Set(),
  stats: { fps: 0, p95: 0, shapes: 0, zoom: 1, engineMs: 0 },
  bench: undefined,
  sync: { status: "offline", pending: 0, wantOnline: true, docId: "default" },
  setTool: (tool) => set({ tool }),
  setSync: (sync) => set((state) => ({ sync: { ...state.sync, ...sync } })),
  setSelection: (selection) => set({ selection }),
  setStats: (stats) => set((state) => ({ stats: { ...state.stats, ...stats } })),
  setBench: (bench) => set({ bench }),
}));
