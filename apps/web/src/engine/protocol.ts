import type { NodeId, ShapeProps, ShapeView } from "@canvas/doc";

/**
 * Messages between the UI thread and the engine worker.
 *
 * Every command carries a `seq` (monotonic per tab). The worker echoes it on the
 * resulting patch, so the UI can tell whether a patch is older than an edit it has
 * already shown optimistically (see Scene.applyPatch).
 */
export type EngineCommand =
  | { readonly type: "create"; readonly seq: number; readonly shapes: ReadonlyArray<{ id: NodeId; props: ShapeProps }> }
  | {
      readonly type: "update";
      readonly seq: number;
      readonly updates: ReadonlyArray<{ id: NodeId; patch: Partial<ShapeProps> }>;
    }
  | { readonly type: "delete"; readonly seq: number; readonly ids: readonly NodeId[] }
  | { readonly type: "front"; readonly seq: number; readonly ids: readonly NodeId[] };

export interface PatchEvent {
  readonly type: "patch";
  readonly seq: number;
  readonly upserts: readonly ShapeView[];
  readonly removes: readonly NodeId[];
  /** Full back-to-front order, present only when structure changed. */
  readonly order?: readonly NodeId[];
  /** Time the worker spent applying the command and building the patch. */
  readonly engineMs: number;
}

export interface ErrorEvent {
  readonly type: "error";
  readonly seq: number;
  readonly message: string;
}

export type EngineEvent = PatchEvent | ErrorEvent;
