/**
 * The engine worker: owns the CRDT document and the sync connection. All CRDT work
 * (clocks, op logs, undo/redo, merges) and all network I/O happen here, so neither
 * can stall rendering or input.
 *
 *   UI command → doc (local) → patch to UI + push to server
 *   server delta → doc.merge → patch to UI
 */
import { CanvasDocument, touchedIds, type DocDelta } from "@canvas/doc";
import { SyncClient } from "@canvas/sync";
import type { EditCommand, EngineCommand, EngineEvent, PatchEvent } from "./protocol";

interface WorkerScope {
  postMessage(message: EngineEvent): void;
  addEventListener(type: "message", listener: (event: MessageEvent<EngineCommand>) => void): void;
}
const scope = self as unknown as WorkerScope;

const replica = crypto.randomUUID();
const doc = new CanvasDocument(replica);
let sync: SyncClient | undefined;
let lastSeq = 0;

function apply(command: EditCommand): DocDelta {
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

function patchFor(seq: number, delta: DocDelta, started: number, remote: boolean): PatchEvent {
  const upserts = [];
  const removes = [];
  for (const id of touchedIds(delta)) {
    const view = doc.shape(id);
    if (view) upserts.push(view);
    else removes.push(id);
  }
  const base = { type: "patch" as const, seq, upserts, removes, remote };
  const order = delta.tree.length > 0 ? doc.shapes().map((shape) => shape.id) : undefined;
  const engineMs = performance.now() - started;
  return order ? { ...base, order, engineMs } : { ...base, engineMs };
}

function connect(url: string, docId: string): void {
  sync?.stop();
  sync = new SyncClient({
    url,
    docId,
    clientId: replica,
    onDelta: (delta) => {
      const started = performance.now();
      doc.merge(delta);
      scope.postMessage(patchFor(lastSeq, delta, started, true));
    },
    onState: (state) => scope.postMessage({ type: "sync", ...state }),
  });
  sync.start();
}

scope.addEventListener("message", (event) => {
  const command = event.data;
  if (command.type === "connect") return connect(command.url, command.docId);
  if (command.type === "network") {
    if (command.online) sync?.start();
    else sync?.stop();
    return;
  }

  const started = performance.now();
  try {
    const delta = apply(command);
    lastSeq = command.seq;
    scope.postMessage(patchFor(command.seq, delta, started, false));
    sync?.push(delta);
  } catch (error) {
    scope.postMessage({ type: "error", seq: command.seq, message: error instanceof Error ? error.message : String(error) });
  }
});
