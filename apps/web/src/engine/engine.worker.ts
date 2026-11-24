/**
 * The engine worker: owns the CRDT document, its IndexedDB journal and the sync
 * connection. All CRDT work, storage I/O and network I/O happen here, so none of it
 * can stall rendering or input.
 *
 *   open          IndexedDB → restored document → full patch to UI
 *   UI command    doc (local) → patch to UI → journal + push to server
 *   undo / redo   doc.undo() → (a new local edit) → same path
 *   server delta  doc.merge → journal → patch to UI
 *   history       server state at seq N → shapes to UI (read-only preview)
 */
import { CanvasDocument, META_ID, touchedIds, type DocDelta, type ShapeView } from "@canvas/doc";
import { LocalStore, OfflineReplica } from "@canvas/sync/offline";
import type { EditCommand, EngineCommand, EngineEvent, PatchEvent } from "./protocol";

interface WorkerScope {
  postMessage(message: EngineEvent): void;
  addEventListener(type: "message", listener: (event: MessageEvent<EngineCommand>) => void): void;
}
const scope = self as unknown as WorkerScope;

let ready: Promise<OfflineReplica | undefined> = Promise.resolve(undefined);
let lastSeq = 0;
/** The most recently fetched history version, so "restore" uses exactly what was previewed. */
let lastVersion: { at: number; shapes: readonly ShapeView[] } | undefined;

function patchFor(doc: CanvasDocument, seq: number, delta: DocDelta, started: number, remote: boolean): PatchEvent {
  const upserts = [];
  const removes = [];
  for (const id of touchedIds(delta)) {
    if (id === META_ID) {
      scope.postMessage({ type: "title", title: doc.title, meta: doc.meta });
      continue;
    }
    const view = doc.shape(id);
    if (view) upserts.push(view);
    else removes.push(id);
  }
  const base = { type: "patch" as const, seq, upserts, removes, remote };
  const order = delta.tree.length > 0 ? doc.shapes().map((shape) => shape.id) : undefined;
  const engineMs = performance.now() - started;
  return order ? { ...base, order, engineMs } : { ...base, engineMs };
}

async function versionAt(replica: OfflineReplica, at: number): Promise<{ at: number; head: number; shapes: ShapeView[] }> {
  const version = await replica.history(at);
  const doc = new CanvasDocument("history-view"); // read-only: only ever merges
  doc.merge(version.state);
  return { at: version.at, head: version.head, shapes: doc.shapes() };
}

/** Run an edit and report what changed. Returns the delta to journal + sync. */
async function edit(replica: OfflineReplica, command: EditCommand): Promise<DocDelta | undefined> {
  const doc = replica.doc;
  const options = "group" in command && command.group !== undefined ? { group: command.group } : undefined;
  switch (command.type) {
    case "create":
      return doc.createShapes(command.shapes, options);
    case "update":
      return doc.updateShapes(command.updates, options);
    case "delete":
      return doc.deleteShapes(command.ids, options);
    case "front":
      return doc.bringToFront(command.ids, options);
    case "back":
      return doc.sendToBack(command.ids, options);
    case "title":
      return doc.setTitle(command.title);
    case "meta":
      return doc.setMeta(command.meta);
    case "vote":
      return doc.vote(command.id, command.voter, command.on);
    case "reply":
      return doc.reply(command.id, command.key, command.value);
    case "undo":
    case "redo": {
      const result = command.type === "undo" ? doc.undo() : doc.redo();
      scope.postMessage({
        type: "undoState",
        canUndo: doc.canUndo,
        canRedo: doc.canRedo,
        skipped: result?.skipped ?? 0,
        action: command.type,
      });
      return result?.delta;
    }
    case "restore": {
      const version = lastVersion?.at === command.at ? lastVersion : await versionAt(replica, command.at);
      const delta = doc.restoreTo(version.shapes);
      scope.postMessage({ type: "undoState", canUndo: doc.canUndo, canRedo: doc.canRedo, action: "restore" });
      return delta;
    }
  }
}

async function open(url: string, docId: string, online: boolean, token: string | undefined): Promise<OfflineReplica> {
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
    ...(token ? { token } : {}),
    onRemote: (delta) => scope.postMessage(patchFor(replica.doc, lastSeq, delta, performance.now(), true)),
    onState: (state) => scope.postMessage({ type: "sync", ...state }),
    onPresence: (clientId, presence) => scope.postMessage({ type: "presence", clientId, presence }),
    onSignal: (from, data) => scope.postMessage({ type: "signal", from, data }),
  });

  const shapes = replica.doc.shapes();
  scope.postMessage({ type: "title", title: replica.doc.title, meta: replica.doc.meta });
  scope.postMessage({ type: "patch", seq: 0, upserts: shapes, removes: [], order: shapes.map((s) => s.id), engineMs: 0, remote: true });
  scope.postMessage({
    type: "restored",
    resumed: replica.restored.resumed,
    shapes: shapes.length,
    pending: replica.restored.pending,
    persistent: storage !== undefined,
    clientId: replica.replicaId,
  });
  scope.postMessage({ type: "sync", status: "offline", pending: replica.sync.pending, cursor: replica.sync.cursor, readOnly: false });
  if (online) replica.start();
  return replica;
}

scope.addEventListener("message", (event) => {
  const command = event.data;
  switch (command.type) {
    case "connect":
      ready = open(command.url, command.docId, command.online, command.token).catch((error: unknown) => {
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
    case "signal":
      void ready.then((replica) => replica?.signal(command.to, command.data));
      return;
    case "history":
      void ready.then(async (replica) => {
        if (!replica) return;
        try {
          const version = await versionAt(replica, command.at);
          lastVersion = { at: version.at, shapes: version.shapes };
          scope.postMessage({ type: "history", requestId: command.requestId, ...version });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          scope.postMessage({ type: "historyError", requestId: command.requestId, message });
        }
      });
      return;
    default: {
      // Edits queue behind `ready`, so commands sent while IndexedDB loads aren't lost.
      // (Each .then runs in order of registration, so edit order is preserved.)
      const command_ = command;
      ready = ready.then(async (replica) => {
        if (!replica) return replica;
        const started = performance.now();
        try {
          const delta = await edit(replica, command_);
          lastSeq = command_.seq;
          if (delta) {
            scope.postMessage(patchFor(replica.doc, command_.seq, delta, started, false));
            replica.commit(delta);
          }
          if (command_.type !== "undo" && command_.type !== "redo" && command_.type !== "restore" && command_.type !== "title" && command_.type !== "meta" && command_.type !== "vote" && command_.type !== "reply") {
            scope.postMessage({ type: "undoState", canUndo: replica.doc.canUndo, canRedo: replica.doc.canRedo });
          }
        } catch (error) {
          scope.postMessage({ type: "error", seq: command_.seq, message: error instanceof Error ? error.message : String(error) });
        }
        return replica;
      });
    }
  }
});
