import { encodeServerMessage, type ServerMessage } from "@canvas/sync";
import type { Store } from "./store.js";

/** What a Room needs from a connection. */
export interface RoomClient {
  readonly clientId: string;
  presence: Uint8Array | undefined;
  send(message: ServerMessage): void;
  sendRaw(bytes: Uint8Array): void;
}

interface Pending {
  readonly delta: Uint8Array;
  /** Set when this instance appended it: that client gets an ACK instead of the delta. */
  readonly origin?: { readonly client: RoomClient; readonly clientSeq: number };
}

/** How long a gap in the sequence may stay open before we fetch it from the store. */
const GAP_FILL_MS = 100;
/**
 * A gap only shows up when a LATER seq arrives. If the bus loses the newest delta (Redis
 * pub/sub is fire-and-forget), nothing later may come for a while, so while a room has
 * clients it also compares its position with the store's head on this interval.
 */
const TAIL_CHECK_MS = 1_000;

/**
 * One document on one server instance: its local clients and an ordered delivery stream.
 *
 * With several instances, this instance learns about seq N from the bus but appends
 * seq N+1 itself, so deltas reach it out of order. If N+1 went to a client first, the
 * client's cursor would jump past N, and when N arrived it would be discarded as
 * "already seen", lost for good. So every delta (and every ACK, which also moves a
 * cursor) goes through `offer()`, which releases seqs strictly in order: delivered+1,
 * delivered+2, ... Out-of-order arrivals wait in `#pending`, and a gap that stays open
 * is filled from the store, which is the source of truth.
 *
 * Everything that touches the stream runs on one async queue per document.
 */
export class Room {
  readonly docId: string;
  readonly clients = new Set<RoomClient>();
  /** Presence of clients connected to OTHER instances (learned via the bus). */
  readonly remotePresence = new Map<string, Uint8Array>();
  /** Highest seq delivered (in order) to this room's clients. */
  delivered = 0;
  readonly stats = { gapFills: 0, outOfOrder: 0 };

  readonly #store: Store;
  readonly #pending = new Map<number, Pending>();
  #queue: Promise<void>;
  #gapTimer: ReturnType<typeof setTimeout> | undefined;
  readonly #tailTimer: ReturnType<typeof setInterval> | undefined;
  #closed = false;

  constructor(docId: string, store: Store, init: (room: Room) => Promise<void>, options: { tailCheck?: boolean } = {}) {
    this.docId = docId;
    this.#store = store;
    // The first task: subscribe to the bus, THEN read the head. Anything appended after
    // that read is guaranteed to arrive via the bus (or a gap fill).
    this.#queue = init(this).then(async () => {
      this.delivered = await store.head(docId);
    });
    if (options.tailCheck) {
      this.#tailTimer = setInterval(() => {
        if (this.clients.size > 0) void this.run(() => this.#catchUp());
      }, TAIL_CHECK_MS);
      this.#tailTimer.unref();
    }
  }

  /** Deliver anything the store has that this room hasn't (lost bus messages). */
  async #catchUp(): Promise<void> {
    const head = await this.#store.head(this.docId);
    if (head <= this.delivered) return;
    this.stats.gapFills += 1;
    for (const entry of await this.#store.readSince(this.docId, this.delivered, head)) this.offer(entry.seq, entry.delta);
  }

  run(task: () => Promise<void> | void): Promise<void> {
    const next = this.#queue.then(task);
    this.#queue = next.catch((error: unknown) => console.error(`room ${this.docId}:`, error));
    return next;
  }

  /** Hand a delta to the ordered stream. Call inside run(). */
  offer(seq: number, delta: Uint8Array, origin?: Pending["origin"]): void {
    if (seq <= this.delivered || this.#pending.has(seq)) {
      // Already delivered (e.g. both the bus and a gap fill brought it). An origin would
      // still be owed its ACK, and everything up to `delivered` is out, so ack there.
      if (origin) origin.client.send({ type: "ack", clientSeq: origin.clientSeq, serverSeq: this.delivered });
      return;
    }
    if (seq !== this.delivered + 1) this.stats.outOfOrder += 1;
    this.#pending.set(seq, origin ? { delta, origin } : { delta });
    this.#flush();
  }

  close(): void {
    this.#closed = true;
    clearTimeout(this.#gapTimer);
    clearInterval(this.#tailTimer);
  }

  #flush(): void {
    for (let next = this.#pending.get(this.delivered + 1); next; next = this.#pending.get(this.delivered + 1)) {
      const seq = this.delivered + 1;
      this.#pending.delete(seq);
      this.delivered = seq;
      const relay = encodeServerMessage({ type: "delta", serverSeq: seq, delta: next.delta });
      for (const client of this.clients) {
        if (next.origin?.client === client) client.send({ type: "ack", clientSeq: next.origin.clientSeq, serverSeq: seq });
        else client.sendRaw(relay);
      }
    }
    if (this.#pending.size > 0) this.#scheduleGapFill();
    else {
      clearTimeout(this.#gapTimer);
      this.#gapTimer = undefined;
    }
  }

  #scheduleGapFill(): void {
    if (this.#gapTimer || this.#closed) return;
    this.#gapTimer = setTimeout(() => {
      this.#gapTimer = undefined;
      void this.run(async () => {
        if (this.#pending.size === 0) return;
        const firstPending = Math.min(...this.#pending.keys());
        if (firstPending === this.delivered + 1) return this.#flush();
        // Seqs are assigned under a per-document lock and published after commit, so a
        // committed N+1 implies a committed N: the store always has the missing range.
        this.stats.gapFills += 1;
        for (const entry of await this.#store.readSince(this.docId, this.delivered, firstPending - 1)) {
          this.offer(entry.seq, entry.delta);
        }
      });
    }, GAP_FILL_MS);
  }
}
