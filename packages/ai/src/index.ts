/**
 * @canvas/ai — local-model board generation: a request goes in, validated board events
 * stream out. No canvas or CRDT code here: the app turns events into ordinary edits.
 */
export { BoardPlanReader, runAssistant, type AiEvent, type AssistantOptions } from "./assistant.js";
export { JsonStreamParser, pathMatches, type CompletedValue, type JsonPath } from "./json-stream.js";
export { CARD, boardSize, headerRect, itemRect, titleRect, type Point, type Rect } from "./layout.js";
export { OllamaError, streamChat, type ChatChunk, type ChatOptions } from "./ollama.js";
export {
  BOARD_SCHEMA,
  COLORS,
  LIMITS,
  ORGANIZE_SCHEMA,
  buildMessages,
  schemaFor,
  cleanColor,
  cleanSource,
  cleanText,
  type AiRequest,
  type ChatMessage,
  type ColorName,
} from "./plan.js";
