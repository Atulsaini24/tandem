/**
 * The engine worker: owns the CRDT document, its IndexedDB journal and the sync
 * connection. All CRDT work, storage I/O and network I/O happen here, so none of it
 * can stall rendering or input.
 *
 *   open          IndexedDB → restored document → full patch to UI
 *   UI command    doc (local) → patch to UI → journal + push to server
 *   server delta  doc.merge → journal → patch to UI
 */
import { type CanvasDocument, touchedIds, type DocDelta } from "@canvas/doc";
import { LocalStore, OfflineReplica } from "@canvas/sync/offline";
import type { EditCommand, EngineCommand, EngineEvent, PatchEvent } from "./protocol";

interface WorkerScope {
  postMessage(message: EngineEvent): void;
  addEventListener(type: "message", listener: (event: MessageEvent<EngineCommand>) => void): void;
}
const scope = self as unknown as WorkerScope;

let ready: Promise<OfflineReplica | undefined> = Promise.resolve(undefined);
let lastSeq = 0;

function apply(doc: CanvasDocument, command: EditCommand): DocDelta {
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

function patchFor(doc: CanvasDocument, seq: number, delta: DocDelta, started: number, remote: boolean): PatchEvent {
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

async function open(url: string, docId: string, online: boolean): Promise<OfflineReplica> {
  let storage: LocalStore | undefined;
  try {
    storage = await LocalStore.open();
  } catch (error) {
    // Private browsing / blocked storage: keep working, just without offline persistence.
    console.warn("IndexedDB unavailable, running without offline persistence", error);
  }
  const replica: OfflineReplica = await OfflineReplica.open({
    url,
    docId,
    ...(storage ? { storage } : {}),
    onRemote: (delta) => scope.postMessage(patchFor(replica.doc, lastSeq, delta, performance.now(), true)),
    onState: (state) => scope.postMessage({ type: "sync", ...state }),
    onPresence: (clientId, presence) => scope.postMessage({ type: "presence", clientId, presence }),
  });

  const shapes = replica.doc.shapes();
  scope.postMessage({ type: "patch", seq: 0, upserts: shapes, removes: [], order: shapes.map((s) => s.id), engineMs: 0, remote: true });
  scope.postMessage({
    type: "restored",
    resumed: replica.restored.resumed,
    shapes: shapes.length,
    pending: replica.restored.pending,
    persistent: storage !== undefined,
  });
  scope.postMessage({ type: "sync", status: "offline", pending: replica.sync.pending, cursor: replica.sync.cursor });
  if (online) replica.start();
  return replica;
}

scope.addEventListener("message", (event) => {
  const command = event.data;
  switch (command.type) {
    case "connect":
      ready = open(command.url, command.docId, command.online).catch((error: unknown) => {
        console.error("failed to open document", error);
        return undefined;
      });
      return;
    case "network":
      void ready.then((replica) => (command.online ? replica?.start() : replica?.stop()));
      return;
    case "presence":
      void ready.then((replica) => replica?.setPresence(command.presence));
      return;
    default: {
      // Edits queue behind `ready`, so commands sent while IndexedDB loads aren't lost.
      const edit = command;
      void ready.then((replica) => {
        if (!replica) return;
        const started = performance.now();
        try {
          const delta = apply(replica.doc, edit);
          lastSeq = edit.seq;
          scope.postMessage(patchFor(replica.doc, edit.seq, delta, started, false));
          replica.commit(delta);
        } catch (error) {
          scope.postMessage({ type: "error", seq: edit.seq, message: error instanceof Error ? error.message : String(error) });
        }
      });
    }
  }
});
