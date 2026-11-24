/**
 * @canvas/doc — the canvas document model, composed from @canvas/crdt primitives.
 */
export {
  CanvasDocument,
  EMPTY_DELTA,
  MAX_LABEL_CHARS,
  MAX_TITLE_CHARS,
  META_ID,
  VOTE_PREFIX,
  MAX_DATA_CHARS,
  MAX_POINTS_CHARS,
  formatPoints,
  parsePoints,
  SHAPE_KINDS,
  touchedIds,
  validatePatch,
  type BoardMeta,
  type DocDelta,
  type EditOptions,
  type UndoResult,
  type PropValue,
  type PropsDelta,
  type TextsDelta,
  type ShapeKind,
  type ShapeProps,
  type ShapeView,
} from "./document.js";
export type { NodeId } from "@canvas/crdt";

