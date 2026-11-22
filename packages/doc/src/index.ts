/**
 * @canvas/doc — the canvas document model, composed from @canvas/crdt primitives.
 */
export {
  CanvasDocument,
  EMPTY_DELTA,
  SHAPE_KINDS,
  touchedIds,
  validatePatch,
  type DocDelta,
  type PropValue,
  type PropsDelta,
  type ShapeKind,
  type ShapeProps,
  type ShapeView,
} from "./document.js";
export type { NodeId } from "@canvas/crdt";
