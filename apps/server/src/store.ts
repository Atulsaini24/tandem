/**
 * Durable, append-only log of deltas per document.
 *
 * The server never interprets deltas beyond validation: it stores the exact bytes a
 * client pushed, numbered 1, 2, 3… per document. That number (serverSeq) is the only
 * cursor a client needs: "send me everything after N".
 */
export interface StoredDelta {
  readonly seq: number;
  readonly delta: Uint8Array;
}

export interface Store {
  readonly kind: string;
  /**
   * Append a client's delta. Returns its serverSeq, or "duplicate" if this
   * (clientId, clientSeq) was already stored (a resend after a lost ACK).
   * Callers must serialize appends per document (see Room).
   */
  append(docId: string, clientId: string, clientSeq: number, delta: Uint8Array): Promise<number | "duplicate">;
  readSince(docId: string, since: number): Promise<StoredDelta[]>;
  head(docId: string): Promise<number>;
  close(): Promise<void>;
}

interface MemoryDoc {
  readonly entries: StoredDelta[];
  readonly seen: Set<string>;
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

  async readSince(docId: string, since: number): Promise<StoredDelta[]> {
    return this.#doc(docId).entries.slice(since);
  }

  async head(docId: string): Promise<number> {
    return this.#doc(docId).entries.length;
  }

  async close(): Promise<void> {}

  /** Test helper: how many deltas are stored for a document. */
  size(docId: string): number {
    return this.#doc(docId).entries.length;
  }

  #doc(docId: string): MemoryDoc {
    let doc = this.#docs.get(docId);
    if (!doc) {
      doc = { entries: [], seen: new Set() };
      this.#docs.set(docId, doc);
    }
    return doc;
  }
}
