/**
 * Durable, append-only log of deltas per document, plus periodic snapshots.
 *
 * The server never interprets deltas beyond validation: it stores the exact bytes a
 * client pushed, numbered 1, 2, 3… per document. That number (serverSeq) is the only
 * cursor a client needs: "send me everything after N".
 *
 * Snapshots are the merged document state at some seq. They make joining fast
 * (snapshot + tail instead of the whole log) and history cheap (nearest snapshot +
 * a short replay). The log itself is never truncated: it IS the document's history.
 */
export interface StoredDelta {
  readonly seq: number;
  readonly delta: Uint8Array;
}

export interface StoredSnapshot {
  readonly seq: number;
  /** An encoded DocDelta holding the full merged state at `seq`. */
  readonly state: Uint8Array;
}

export interface AppendItem {
  readonly clientId: string;
  readonly clientSeq: number;
  readonly delta: Uint8Array;
}

export interface Store {
  readonly kind: string;
  /**
   * Append a client's delta. Returns its serverSeq, or "duplicate" if this
   * (clientId, clientSeq) was already stored (a resend after a lost ACK).
   */
  append(docId: string, clientId: string, clientSeq: number, delta: Uint8Array): Promise<number | "duplicate">;
  /**
   * Append several deltas atomically, in order (group commit). Seqs stay gapless:
   * duplicates are detected BEFORE numbering, so they never consume a seq.
   */
  appendBatch(docId: string, items: readonly AppendItem[]): Promise<Array<number | "duplicate">>;
  /** Deltas with since < seq ≤ until (until defaults to the head), in order. */
  readSince(docId: string, since: number, until?: number): Promise<StoredDelta[]>;
  head(docId: string): Promise<number>;
  putSnapshot(docId: string, snapshot: StoredSnapshot): Promise<void>;
  /** The latest snapshot with seq ≤ atOrBefore (default: the latest of all). */
  snapshot(docId: string, atOrBefore?: number): Promise<StoredSnapshot | undefined>;
  close(): Promise<void>;
}

interface MemoryDoc {
  readonly entries: StoredDelta[];
  readonly seen: Set<string>;
  readonly snapshots: StoredSnapshot[];
}

/** In-process store: tests, and running the server without a database. */
export class MemoryStore implements Store {
  readonly kind = "memory";
  readonly #docs = new Map<string, MemoryDoc>();

  async append(docId: string, clientId: string, clientSeq: number, delta: Uint8Array): Promise<number | "duplicate"> {
    const doc = this.#doc(docId);
    const key = `${clientId}\u0000${clientSeq}`;
    if (doc.seen.has(key)) return "duplicate";
    doc.seen.add(key);
    const seq = doc.entries.length + 1;
    doc.entries.push({ seq, delta });
    return seq;
  }

  async appendBatch(docId: string, items: readonly AppendItem[]): Promise<Array<number | "duplicate">> {
    const results: Array<number | "duplicate"> = [];
    for (const item of items) results.push(await this.append(docId, item.clientId, item.clientSeq, item.delta));
    return results;
  }

  async readSince(docId: string, since: number, until?: number): Promise<StoredDelta[]> {
    return this.#doc(docId).entries.slice(since, until);
  }

  async head(docId: string): Promise<number> {
    return this.#doc(docId).entries.length;
  }

  async putSnapshot(docId: string, snapshot: StoredSnapshot): Promise<void> {
    const snapshots = this.#doc(docId).snapshots;
    if (snapshots.some((s) => s.seq === snapshot.seq)) return;
    snapshots.push(snapshot);
    snapshots.sort((a, b) => a.seq - b.seq);
  }

  async snapshot(docId: string, atOrBefore = Infinity): Promise<StoredSnapshot | undefined> {
    return this.#doc(docId).snapshots.filter((s) => s.seq <= atOrBefore).at(-1);
  }

  async close(): Promise<void> {}

  /** Test helper: how many deltas are stored for a document. */
  size(docId: string): number {
    return this.#doc(docId).entries.length;
  }

  #doc(docId: string): MemoryDoc {
    let doc = this.#docs.get(docId);
    if (!doc) {
      doc = { entries: [], seen: new Set(), snapshots: [] };
      this.#docs.set(docId, doc);
    }
    return doc;
  }
}
