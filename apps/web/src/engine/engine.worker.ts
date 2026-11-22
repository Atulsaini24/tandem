/**
 * The engine worker: owns the CRDT document. All CRDT work (clocks, op logs,
 * undo/redo, merges) happens here, so it can never stall rendering or input.
 *
 * In M5 this is also where network deltas are merged and outgoing deltas are sent.
 */
import { CanvasDocument, touchedIds, type DocDelta } from "@canvas/doc";
import type { EngineCommand, EngineEvent, PatchEvent } from "./protocol";

interface WorkerScope {
  postMessage(message: EngineEvent): void;
  addEventListener(type: "message", listener: (event: MessageEvent<EngineCommand>) => void): void;
}
const scope = self as unknown as WorkerScope;

const doc = new CanvasDocument(crypto.randomUUID());

function apply(command: EngineCommand): DocDelta {
  switch (command.type) {
    case "create":
      return doc.createShapes(command.shapes);
    case "update":
      return doc.updateShapes(command.updates);
    case "delete":
      return doc.deleteShapes(command.ids);
    case "front":
      return doc.bringToFront(command.ids);
  }
}

function patchFor(seq: number, delta: DocDelta, started: number): PatchEvent {
  const upserts = [];
  const removes = [];
  for (const id of touchedIds(delta)) {
    const view = doc.shape(id);
    if (view) upserts.push(view);
    else removes.push(id);
  }
  const base = { type: "patch" as const, seq, upserts, removes };
  const order = delta.tree.length > 0 ? doc.shapes().map((shape) => shape.id) : undefined;
  const engineMs = performance.now() - started;
  return order ? { ...base, order, engineMs } : { ...base, engineMs };
}

scope.addEventListener("message", (event) => {
  const command = event.data;
  const started = performance.now();
  try {
    scope.postMessage(patchFor(command.seq, apply(command), started));
  } catch (error) {
    scope.postMessage({ type: "error", seq: command.seq, message: error instanceof Error ? error.message : String(error) });
  }
});
