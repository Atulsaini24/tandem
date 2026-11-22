import type { BoardMeta, NodeId, ShapeProps, ShapeView } from "@canvas/doc";
import type { Presence, SyncStatus } from "@canvas/sync";

/**
 * Messages between the UI thread and the engine worker.
 *
 * Every edit command carries a `seq` (monotonic per tab). The worker echoes it on the
 * resulting patch, so the UI can tell whether a patch is older than an edit it has
 * already shown optimistically (see Scene.applyPatch). Patches caused by REMOTE edits
 * carry the seq of the last local command the worker processed.
 *
 * `group`: edits with the same group (e.g. every step of one drag) undo as one step.
 */
export type EditCommand =
  | {
      readonly type: "create";
      readonly seq: number;
      readonly shapes: ReadonlyArray<{ id: NodeId; props: ShapeProps }>;
      readonly group?: number;
    }
  | {
      readonly type: "update";
      readonly seq: number;
      readonly updates: ReadonlyArray<{ id: NodeId; patch: Partial<ShapeProps> }>;
      readonly group?: number;
    }
  | { readonly type: "delete"; readonly seq: number; readonly ids: readonly NodeId[]; readonly group?: number }
  | { readonly type: "front"; readonly seq: number; readonly ids: readonly NodeId[]; readonly group?: number }
  | { readonly type: "back"; readonly seq: number; readonly ids: readonly NodeId[]; readonly group?: number }
  /** Rename the board (synced, last writer wins; not an undo step). */
  | { readonly type: "title"; readonly seq: number; readonly title: string }
  /** Shared timer and other board settings (synced, not an undo step). */
  | { readonly type: "meta"; readonly seq: number; readonly meta: Omit<BoardMeta, "title"> }
  /** Toggle this person's dot vote on a shape (not an undo step). */
  | { readonly type: "vote"; readonly seq: number; readonly id: NodeId; readonly voter: string; readonly on: boolean }
  | { readonly type: "undo"; readonly seq: number }
  | { readonly type: "redo"; readonly seq: number }
  /** Make the live document match the version at server seq `at`. */
  | { readonly type: "restore"; readonly seq: number; readonly at: number };

export type ControlCommand =
  /** Open the document (restoring it from IndexedDB) and optionally go online. */
  | { readonly type: "connect"; readonly url: string; readonly docId: string; readonly online: boolean; readonly token?: string }
  /** Go offline / back online (the demo toggle). */
  | { readonly type: "network"; readonly online: boolean }
  | { readonly type: "presence"; readonly presence: Presence }
  /** Fetch the document as it was at server seq `at` (Infinity-ish = the head). */
  | { readonly type: "history"; readonly requestId: number; readonly at: number };

export type EngineCommand = EditCommand | ControlCommand;

export interface PatchEvent {
  readonly type: "patch";
  readonly seq: number;
  readonly upserts: readonly ShapeView[];
  readonly removes: readonly NodeId[];
  /** Full back-to-front order, present only when structure changed. */
  readonly order?: readonly NodeId[];
  /** Time the worker spent applying the change and building the patch. */
  readonly engineMs: number;
  readonly remote: boolean;
}

export interface ErrorEvent {
  readonly type: "error";
  readonly seq: number;
  readonly message: string;
}

export interface SyncEvent {
  readonly type: "sync";
  readonly status: SyncStatus;
  readonly pending: number;
  readonly cursor: number;
  readonly readOnly: boolean;
  readonly error?: string;
}

/** What was recovered from IndexedDB when the document opened. */
export interface RestoredEvent {
  readonly type: "restored";
  readonly resumed: boolean;
  readonly shapes: number;
  readonly pending: number;
  readonly persistent: boolean;
}

export interface PresenceEvent {
  readonly type: "presence";
  readonly clientId: string;
  /** null = they left. */
  readonly presence: Presence | null;
}

export interface UndoStateEvent {
  readonly type: "undoState";
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Set after an undo/redo: changes left alone because someone else edited them since. */
  readonly skipped?: number;
  readonly action?: "undo" | "redo" | "restore";
}

export type HistoryEvent =
  | { readonly type: "history"; readonly requestId: number; readonly at: number; readonly head: number; readonly shapes: readonly ShapeView[] }
  | { readonly type: "historyError"; readonly requestId: number; readonly message: string };

/** Board settings (name, shared timer) changed, or were read when the document opened. */
export interface TitleEvent {
  readonly type: "title";
  readonly title: string | undefined;
  readonly meta: BoardMeta;
}

export type EngineEvent = TitleEvent | PatchEvent | ErrorEvent | SyncEvent | RestoredEvent | PresenceEvent | UndoStateEvent | HistoryEvent;
