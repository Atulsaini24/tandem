import type { NodeId, ShapeProps, ShapeView } from "@canvas/doc";
import type { Presence, SyncStatus } from "@canvas/sync";

/**
 * Messages between the UI thread and the engine worker.
 *
 * Every edit command carries a `seq` (monotonic per tab). The worker echoes it on the
 * resulting patch, so the UI can tell whether a patch is older than an edit it has
 * already shown optimistically (see Scene.applyPatch). Patches caused by REMOTE edits
 * carry the seq of the last local command the worker processed.
 */
export type EditCommand =
  | { readonly type: "create"; readonly seq: number; readonly shapes: ReadonlyArray<{ id: NodeId; props: ShapeProps }> }
  | {
      readonly type: "update";
      readonly seq: number;
      readonly updates: ReadonlyArray<{ id: NodeId; patch: Partial<ShapeProps> }>;
    }
  | { readonly type: "delete"; readonly seq: number; readonly ids: readonly NodeId[] }
  | { readonly type: "front"; readonly seq: number; readonly ids: readonly NodeId[] };

export type ControlCommand =
  /** Open the document (restoring it from IndexedDB) and optionally go online. */
  | { readonly type: "connect"; readonly url: string; readonly docId: string; readonly online: boolean }
  /** Go offline / back online (the demo toggle). */
  | { readonly type: "network"; readonly online: boolean }
  | { readonly type: "presence"; readonly presence: Presence };

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

export type EngineEvent = PatchEvent | ErrorEvent | SyncEvent | RestoredEvent | PresenceEvent;
