/**
 * @canvas/crdt — the conflict-free replicated data types that power the canvas.
 *
 * This package is pure TypeScript: no DOM, no network, no storage.
 * Everything here must be deterministic so that every replica converges.
 */

export type { ReplicaId } from "./types.js";
export {
  HybridLogicalClock,
  compareTimestamps,
  type PhysicalClock,
  type Timestamp,
} from "./hlc.js";
export { PNCounter, mergePNCounter, type PNCounterState } from "./pn-counter.js";
export { LWWRegister, mergeLWWEntry, type LWWEntry } from "./lww-register.js";
export { LWWMap, mergeLWWMap, type LWWMapEntry, type LWWMapState } from "./lww-map.js";
export { isValidPosition, positionBetween } from "./fractional-index.js";
export { FugueText, type CharId, type TextDelta, type TextInsert } from "./fugue-text.js";
export {
  MoveTree,
  ROOT,
  TRASH,
  TreeCycleError,
  type MoveOp,
  type NodeId,
  type TreeDelta,
  type TreeNode,
} from "./move-tree.js";

export const CRDT_VERSION = "0.0.0";
