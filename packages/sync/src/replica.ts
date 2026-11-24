import { CanvasDocument, type DocDelta } from "@canvas/doc";
import { decodeDelta, encodeDelta } from "./codec.js";
import { SyncClient, type HistoryVersion, type SocketLike, type SyncResume, type SyncState } from "./client.js";
import type { LoadedReplica, LocalStore } from "./local-store.js";
import { decodePresence, encodePresence, type Presence } from "./presence.js";

/**
 * An offline-first replica of one document: CanvasDocument + SyncClient + LocalStore.
 *
 * Opening it restores the last session from IndexedDB (document state, cursor,
 * unsent edits) and resumes syncing from exactly there. Every local and remote change
 * is journaled as it happens.
 *
 * Replica identity: a replica id must never be used by two live writers at once —
 * their HLC timestamps and clientSeqs would collide, and the server would drop one
 * tab's edits as "duplicates" of the other's. So each persisted replica is LEASED with
 * a Web Lock held for the lifetime of the tab. A reloaded tab resumes a replica only if
 * no living tab holds it; otherwise it starts a fresh replica, seeded with the most
 * recent persisted state.
 */
export interface OfflineReplicaOptions {
  readonly url: string;
  readonly docId: string;
  readonly storage?: LocalStore;
  /** Try to take exclusive ownership of a key. Default: Web Locks (always true where absent). */
  readonly claim?: (key: string) => Promise<boolean>;
  readonly newReplicaId?: () => string;
  readonly onRemote?: (delta: DocDelta) => void;
  readonly onState?: (state: SyncState) => void;
  readonly onPresence?: (clientId: string, presence: Presence | null) => void;
  /** A point-to-point message (text) from another client: WebRTC call setup. */
  readonly onSignal?: (from: string, data: string) => void;
  readonly createSocket?: (url: string) => SocketLike;
  readonly token?: string;
  readonly minBackoffMs?: number;
  readonly maxBackoffMs?: number;
  /** Compact the local log into a snapshot after this many entries. */
  readonly compactEvery?: number;
}

export interface RestoreInfo {
  /** Continued a previous session's replica (same id, same outbox). */
  readonly resumed: boolean;
  /** Started a new replica from another (still-open) tab's persisted state. */
  readonly seeded: boolean;
  /** Snapshot + log entries replayed. */
  readonly entries: number;
  /** Unsent local edits restored into the outbox. */
  readonly pending: number;
}

const lockKey = (docId: string, replicaId: string): string => `canvas-replica:${docId}:${replicaId}`;

/** Web Locks lease: held until the page/worker dies. Without the API, always succeeds. */
export function webLockClaim(key: string): Promise<boolean> {
  const locks = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks;
  if (!locks) return Promise.resolve(true);
  return new Promise((resolve) => {
    void locks.request(key, { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(false);
        return undefined;
      }
      resolve(true);
      return new Promise<void>(() => {}); // never released: the lease ends with the tab
    });
  });
}

export class OfflineReplica {
  readonly doc: CanvasDocument;
  readonly docId: string;
  readonly replicaId: string;
  readonly sync: SyncClient;
  readonly restored: RestoreInfo;
  readonly #storage: LocalStore | undefined;
  readonly #compactEvery: number;

  private constructor(options: OfflineReplicaOptions, replicaId: string, doc: CanvasDocument, resume: SyncResume, restored: RestoreInfo) {
    this.doc = doc;
    this.docId = options.docId;
    this.replicaId = replicaId;
    this.restored = restored;
    this.#storage = options.storage;
    this.#compactEvery = options.compactEvery ?? 500;
    this.sync = new SyncClient({
      url: options.url,
      docId: options.docId,
      clientId: replicaId,
      initial: resume,
      onDelta: (delta, info) => {
        this.doc.merge(delta);
        this.#storage?.recordRemote(this.docId, this.replicaId, info.bytes, info.serverSeq);
        this.#maybeCompact();
        options.onRemote?.(delta);
      },
      onAck: (clientSeq, cursor) => this.#storage?.recordAck(this.docId, this.replicaId, clientSeq, cursor),
      onServerReset: (head) => {
        this.#storage?.resetCursor(this.docId, this.replicaId, head);
        // The server only accepts ops a client authored itself, so each client re-seeds
        // its own share. Together, every connected client restores everything it knows.
        this.commit(this.doc.authoredBy(this.replicaId));
      },
      onPresence: (clientId, payload) => {
        if (!options.onPresence) return;
        if (payload === null) return options.onPresence(clientId, null);
        try {
          options.onPresence(clientId, decodePresence(payload));
        } catch {
          // Malformed presence from another client: ignore it, never crash on it.
        }
      },
      ...(options.onSignal
        ? {
            onSignal: (from: string, payload: Uint8Array) => {
              try {
                options.onSignal?.(from, new TextDecoder("utf-8", { fatal: true }).decode(payload));
              } catch {
                // Not text: not ours.
              }
            },
          }
        : {}),
      ...(options.onState ? { onState: options.onState } : {}),
      ...(options.createSocket ? { createSocket: options.createSocket } : {}),
      ...(options.token ? { token: options.token } : {}),
      ...(options.minBackoffMs === undefined ? {} : { minBackoffMs: options.minBackoffMs }),
      ...(options.maxBackoffMs === undefined ? {} : { maxBackoffMs: options.maxBackoffMs }),
    });
  }

  static async open(options: OfflineReplicaOptions): Promise<OfflineReplica> {
    const { storage, docId } = options;
    const claim = options.claim ?? webLockClaim;
    const newId = options.newReplicaId ?? (() => crypto.randomUUID());

    let replicaId: string | undefined;
    let loaded: LoadedReplica | undefined;
    let seeded = false;

    if (storage) {
      const records = await storage.replicas(docId);
      for (const record of records) {
        if (await claim(lockKey(docId, record.replicaId))) {
          replicaId = record.replicaId;
          loaded = await storage.load(docId, record.replicaId);
          break;
        }
      }
      if (replicaId === undefined) {
        replicaId = newId();
        await claim(lockKey(docId, replicaId));
        const donor = records[0];
        if (donor) {
          loaded = await storage.load(docId, donor.replicaId);
          seeded = loaded !== undefined;
        }
      }
    } else {
      replicaId = newId();
    }

    const doc = new CanvasDocument(replicaId);
    let entries = 0;
    for (const bytes of loaded ? [loaded.snapshot, ...loaded.log] : []) {
      if (!bytes) continue;
      doc.merge(decodeDelta(bytes));
      entries += 1;
    }

    // Resuming keeps the old session's outbox and clientSeq. A seeded replica takes the
    // donor's state and cursor (they match), but not its outbox: those edits belong to
    // the live tab that owns them and will reach us through the server.
    const resume: SyncResume =
      loaded && !seeded
        ? { cursor: loaded.record.cursor, nextClientSeq: loaded.record.nextClientSeq, outbox: loaded.outbox }
        : { cursor: loaded?.record.cursor ?? 0, nextClientSeq: 1, outbox: [] };

    if (storage && (seeded || !loaded)) {
      storage.create(docId, replicaId, resume.cursor, seeded ? encodeDelta(doc.state) : null);
    }

    return new OfflineReplica(options, replicaId, doc, resume, {
      resumed: loaded !== undefined && !seeded,
      seeded,
      entries,
      pending: resume.outbox.length,
    });
  }

  /** Journal and send a local change that has already been applied to `doc`. */
  commit(delta: DocDelta): void {
    const item = this.sync.push(delta);
    if (!item || !this.#storage) return;
    this.#storage.recordLocal(this.docId, this.replicaId, item);
    this.#maybeCompact();
  }

  /** The document as it was at server seq `at` (needs a connection). */
  history(at: number): Promise<HistoryVersion> {
    return this.sync.requestHistory(at);
  }

  /** Send text to one other client in this document. False while offline. */
  signal(to: string, data: string): boolean {
    return this.sync.signal(to, new TextEncoder().encode(data));
  }

  setPresence(presence: Presence): void {
    this.sync.setPresence(encodePresence(presence));
  }

  start(): void {
    this.sync.start();
  }

  stop(): void {
    this.sync.stop();
  }

  /** Resolves when every change so far is durable in IndexedDB. */
  async flush(): Promise<void> {
    await this.#storage?.flush();
  }

  async close(): Promise<void> {
    this.sync.stop();
    await this.flush();
  }

  #maybeCompact(): void {
    const storage = this.#storage;
    if (!storage || storage.logCount(this.docId, this.replicaId) < this.#compactEvery) return;
    storage.compact(this.docId, this.replicaId, encodeDelta(this.doc.state));
  }
}
