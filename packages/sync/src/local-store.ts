import type { OutboxItem } from "./client.js";

/**
 * IndexedDB persistence for offline-first replicas.
 *
 * One record per (document, replica):
 *   replicas   cursor, nextClientSeq, log counters        (small, rewritten often)
 *   snapshots  full encoded document state              (large, rewritten rarely)
 *   log        deltas applied since the snapshot, in order
 *   outbox     local deltas the server hasn't ACKed
 *
 * Restoring = snapshot + replay log; the outbox and cursor resume the sync session.
 *
 * Crash consistency: every logical step is ONE transaction —
 *   local edit   → log entry + outbox entry + nextClientSeq
 *   remote delta → log entry + cursor
 *   ack          → outbox deletions + cursor
 * so the cursor can never be saved ahead of the deltas it claims to cover. A crash can
 * lose the newest step; it can never leave a state that silently skips one.
 *
 * Writes are batched: steps queued in the same tick commit in one transaction.
 */

export interface ReplicaRecord {
  readonly docId: string;
  readonly replicaId: string;
  cursor: number;
  nextClientSeq: number;
  /** Sequence number of the last log entry. */
  logSeq: number;
  /** Entries in the log since the last snapshot (drives compaction). */
  logCount: number;
  updatedAt: number;
}

export interface LoadedReplica {
  readonly record: ReplicaRecord;
  readonly snapshot: Uint8Array | null;
  readonly log: readonly Uint8Array[];
  readonly outbox: readonly OutboxItem[];
}

export interface LocalStoreOptions {
  readonly factory?: IDBFactory;
  readonly keyRange?: typeof IDBKeyRange;
  readonly name?: string;
}

type Op =
  | { readonly kind: "log"; readonly key: readonly [string, string, number]; readonly bytes: Uint8Array }
  | { readonly kind: "outboxPut"; readonly key: readonly [string, string, number]; readonly bytes: Uint8Array }
  | { readonly kind: "outboxDelete"; readonly docId: string; readonly replicaId: string; readonly upTo: number }
  | { readonly kind: "logClear"; readonly docId: string; readonly replicaId: string; readonly upTo: number }
  | { readonly kind: "snapshot"; readonly docId: string; readonly replicaId: string; readonly bytes: Uint8Array };

const STORES = ["replicas", "snapshots", "log", "outbox"];

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}

const recordKey = (docId: string, replicaId: string): string => `${docId}\u0000${replicaId}`;

export class LocalStore {
  readonly #db: IDBDatabase;
  readonly #range: typeof IDBKeyRange;
  readonly #records = new Map<string, ReplicaRecord>();
  readonly #dirty = new Set<string>();
  #queue: Op[] = [];
  #pending: Promise<void> | undefined;
  #error: unknown;

  private constructor(db: IDBDatabase, range: typeof IDBKeyRange) {
    this.#db = db;
    this.#range = range;
  }

  static async open(options: LocalStoreOptions = {}): Promise<LocalStore> {
    const factory = options.factory ?? globalThis.indexedDB;
    const range = options.keyRange ?? globalThis.IDBKeyRange;
    const request = factory.open(options.name ?? "canvas", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("replicas", { keyPath: ["docId", "replicaId"] }).createIndex("byDoc", "docId");
      db.createObjectStore("snapshots", { keyPath: ["docId", "replicaId"] });
      db.createObjectStore("log", { keyPath: ["docId", "replicaId", "n"] });
      db.createObjectStore("outbox", { keyPath: ["docId", "replicaId", "clientSeq"] });
    };
    return new LocalStore(await done(request), range);
  }

  /** Every replica persisted for a document, most recently used first. */
  async replicas(docId: string): Promise<ReplicaRecord[]> {
    const tx = this.#db.transaction("replicas", "readonly");
    const rows = (await done(tx.objectStore("replicas").index("byDoc").getAll(docId))) as ReplicaRecord[];
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async load(docId: string, replicaId: string): Promise<LoadedReplica | undefined> {
    await this.flush();
    const tx = this.#db.transaction(STORES, "readonly");
    const all = this.#range.bound([docId, replicaId, 0], [docId, replicaId, Infinity]);
    // Issue every request before awaiting, so the transaction stays active.
    const [record, snapshot, log, outbox] = await Promise.all([
      done(tx.objectStore("replicas").get([docId, replicaId])) as Promise<ReplicaRecord | undefined>,
      done(tx.objectStore("snapshots").get([docId, replicaId])) as Promise<{ bytes: Uint8Array } | undefined>,
      done(tx.objectStore("log").getAll(all)) as Promise<Array<{ bytes: Uint8Array }>>,
      done(tx.objectStore("outbox").getAll(all)) as Promise<Array<{ clientSeq: number; bytes: Uint8Array }>>,
    ]);
    if (!record) return undefined;
    this.#records.set(recordKey(docId, replicaId), record);
    return {
      record: { ...record },
      snapshot: snapshot?.bytes ?? null,
      log: log.map((entry) => entry.bytes),
      outbox: outbox.map((entry) => ({ clientSeq: entry.clientSeq, bytes: entry.bytes })),
    };
  }

  /** Start persisting a new replica, optionally from a snapshot of seeded state. */
  create(docId: string, replicaId: string, cursor: number, snapshot: Uint8Array | null): void {
    const record: ReplicaRecord = { docId, replicaId, cursor, nextClientSeq: 1, logSeq: 0, logCount: 0, updatedAt: Date.now() };
    this.#records.set(recordKey(docId, replicaId), record);
    if (snapshot) this.#enqueue({ kind: "snapshot", docId, replicaId, bytes: snapshot });
    this.#touch(record);
  }

  /** A local edit: append to the log, queue it in the outbox, advance nextClientSeq. */
  recordLocal(docId: string, replicaId: string, item: OutboxItem): void {
    const record = this.#record(docId, replicaId);
    record.logSeq += 1;
    record.logCount += 1;
    record.nextClientSeq = item.clientSeq + 1;
    this.#enqueue({ kind: "log", key: [docId, replicaId, record.logSeq], bytes: item.bytes });
    this.#enqueue({ kind: "outboxPut", key: [docId, replicaId, item.clientSeq], bytes: item.bytes });
    this.#touch(record);
  }

  /** A remote delta: append to the log and move the cursor in the same transaction. */
  recordRemote(docId: string, replicaId: string, bytes: Uint8Array, serverSeq: number): void {
    const record = this.#record(docId, replicaId);
    record.logSeq += 1;
    record.logCount += 1;
    record.cursor = Math.max(record.cursor, serverSeq);
    this.#enqueue({ kind: "log", key: [docId, replicaId, record.logSeq], bytes });
    this.#touch(record);
  }

  /** The server stored everything up to clientSeq: drop it from the outbox. */
  recordAck(docId: string, replicaId: string, clientSeq: number, cursor: number): void {
    const record = this.#record(docId, replicaId);
    record.cursor = Math.max(record.cursor, cursor);
    this.#enqueue({ kind: "outboxDelete", docId, replicaId, upTo: clientSeq });
    this.#touch(record);
  }

  /** Replace snapshot + log with one snapshot of the current state. */
  compact(docId: string, replicaId: string, snapshot: Uint8Array): void {
    const record = this.#record(docId, replicaId);
    this.#enqueue({ kind: "snapshot", docId, replicaId, bytes: snapshot });
    this.#enqueue({ kind: "logClear", docId, replicaId, upTo: record.logSeq });
    record.logCount = 0;
    this.#touch(record);
  }

  logCount(docId: string, replicaId: string): number {
    return this.#record(docId, replicaId).logCount;
  }

  /** Resolves when everything queued so far is committed; rejects if a write failed. */
  async flush(): Promise<void> {
    while (this.#pending) await this.#pending;
    const error = this.#error;
    this.#error = undefined;
    if (error !== undefined) throw error;
  }

  close(): void {
    this.#db.close();
  }

  #record(docId: string, replicaId: string): ReplicaRecord {
    const record = this.#records.get(recordKey(docId, replicaId));
    if (!record) throw new Error(`replica ${replicaId} of ${docId} is not loaded`);
    return record;
  }

  #touch(record: ReplicaRecord): void {
    record.updatedAt = Date.now();
    this.#dirty.add(recordKey(record.docId, record.replicaId));
    this.#schedule();
  }

  #enqueue(op: Op): void {
    this.#queue.push(op);
    this.#schedule();
  }

  #schedule(): void {
    if (this.#pending) return;
    this.#pending = new Promise<void>((resolve) => setTimeout(resolve, 0))
      .then(() => this.#write())
      .catch((error: unknown) => {
        this.#error = error; // surfaced by the next flush(); later writes still proceed
      })
      .finally(() => {
        this.#pending = undefined;
        if (this.#queue.length > 0 || this.#dirty.size > 0) this.#schedule();
      });
  }

  async #write(): Promise<void> {
    const ops = this.#queue;
    const dirty = [...this.#dirty];
    this.#queue = [];
    this.#dirty.clear();
    if (ops.length === 0 && dirty.length === 0) return;

    const tx = this.#db.transaction(STORES, "readwrite");
    const log = tx.objectStore("log");
    const outbox = tx.objectStore("outbox");
    const snapshots = tx.objectStore("snapshots");
    const replicas = tx.objectStore("replicas");
    const upTo = (docId: string, replicaId: string, n: number): IDBKeyRange =>
      this.#range.bound([docId, replicaId, 0], [docId, replicaId, n]);

    for (const op of ops) {
      switch (op.kind) {
        case "log":
          log.put({ docId: op.key[0], replicaId: op.key[1], n: op.key[2], bytes: op.bytes });
          break;
        case "outboxPut":
          outbox.put({ docId: op.key[0], replicaId: op.key[1], clientSeq: op.key[2], bytes: op.bytes });
          break;
        case "outboxDelete":
          outbox.delete(upTo(op.docId, op.replicaId, op.upTo));
          break;
        case "logClear":
          log.delete(upTo(op.docId, op.replicaId, op.upTo));
          break;
        case "snapshot":
          snapshots.put({ docId: op.docId, replicaId: op.replicaId, bytes: op.bytes });
          break;
      }
    }
    for (const key of dirty) {
      const record = this.#records.get(key);
      if (record) replicas.put({ ...record });
    }
    try {
      await committed(tx);
    } catch (error) {
      console.error("local store: write failed (e.g. storage quota)", error);
      throw error;
    }
  }
}
