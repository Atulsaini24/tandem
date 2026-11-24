import { VersionVector } from "@canvas/crdt";
import type { DocDelta } from "@canvas/doc";
import { decodeDelta, encodeDelta, timestampsOf } from "./codec.js";
import { PROTOCOL_VERSION, decodeServerMessage, encodeClientMessage, type ServerMessage } from "./messages.js";

/**
 * The subset of the WebSocket API this client uses. Browsers, workers and Node 22
 * all provide a global WebSocket that fits; tests can inject their own.
 */
export interface SocketLike {
  binaryType: string;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
}

export type SyncStatus = "offline" | "connecting" | "online";

export interface SyncState {
  readonly status: SyncStatus;
  /** Local deltas not yet acknowledged by the server. */
  readonly pending: number;
  /** Highest server sequence number this client has seen. */
  readonly cursor: number;
  /** The server said this client may only view (a viewer token). */
  readonly readOnly: boolean;
  readonly error?: string;
}

/** A local delta waiting for the server's ACK. */
export interface OutboxItem {
  readonly clientSeq: number;
  readonly bytes: Uint8Array;
}

/** Sync state restored from local storage, so a reload resumes instead of restarting. */
export interface SyncResume {
  readonly cursor: number;
  readonly nextClientSeq: number;
  readonly outbox: readonly OutboxItem[];
}

/** The document as it was at server seq `at` (of `head` total). */
export interface HistoryVersion {
  readonly at: number;
  readonly head: number;
  readonly state: DocDelta;
}

export interface RemoteDeltaInfo {
  readonly serverSeq: number;
  /** The exact bytes received, for persisting without re-encoding. */
  readonly bytes: Uint8Array;
}

export interface SyncClientOptions {
  readonly url: string;
  readonly docId: string;
  readonly clientId: string;
  /** A delta from another client, to merge into the local document. */
  readonly onDelta: (delta: DocDelta, info: RemoteDeltaInfo) => void;
  readonly onState?: (state: SyncState) => void;
  /** The server durably stored every local delta up to `clientSeq`. */
  readonly onAck?: (clientSeq: number, cursor: number) => void;
  /** A point-to-point message from another client (WebRTC call setup). */
  readonly onSignal?: (from: string, payload: Uint8Array) => void;
  /** Another client's presence payload, or null when they leave. */
  readonly onPresence?: (clientId: string, payload: Uint8Array | null) => void;
  /**
   * The server knows less than we do (its head < our cursor): it lost data, e.g. a
   * restart with an in-memory store or a database restored from an older backup. The
   * cursor has been reset to `head`; re-push what this client authored so the server
   * (and everyone else) gets it back.
   */
  readonly onServerReset?: (head: number) => void;
  readonly initial?: SyncResume;
  /** Access token, when the server requires one (see apps/server/src/auth.ts). */
  readonly token?: string;
  readonly createSocket?: (url: string) => SocketLike;
  readonly minBackoffMs?: number;
  readonly maxBackoffMs?: number;
}

/**
 * Flow control: at most this many pushes in flight (sent, not yet ACKed) per connection.
 * More are sent as ACKs come back. Keeps a reconnecting client with a big offline backlog
 * from dumping it all at once into the server's rate limiter.
 */
const PUSH_WINDOW = 64;

function defaultSocket(url: string): SocketLike {
  const WebSocketCtor = (globalThis as unknown as { WebSocket: new (url: string) => SocketLike }).WebSocket;
  return new WebSocketCtor(url);
}

function toBytes(data: unknown): Uint8Array | undefined {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return undefined;
}

/**
 * Keeps one document in sync with the server.
 *
 * Two pieces of state make reconnection cheap and safe:
 *  - cursor: the last server sequence number received. On reconnect the server
 *    sends only deltas after it.
 *  - outbox: local deltas the server hasn't acknowledged. They are (re)sent on every
 *    connect; the server stores each (clientId, clientSeq) once, so a resend after a
 *    lost ACK is harmless. CRDT merge is idempotent anyway — this keeps the log clean.
 *
 * Both can be restored from storage (`initial`), so a page reload resumes exactly
 * where the last session stopped, including edits made offline.
 *
 * Reconnects use exponential backoff with jitter, so a server restart doesn't get
 * hit by every client at the same instant.
 */
export class SyncClient {
  /**
   * Wire-level counters. `deltasReceived` counts every DELTA message that arrived,
   * including ones skipped as already-seen (`duplicatesIgnored`), so tests can prove
   * the server sends only what's missing — not merely that the client coped.
   */
  readonly stats = {
    deltasSent: 0,
    deltasReceived: 0,
    duplicatesIgnored: 0,
    bytesSent: 0,
    bytesReceived: 0,
    connects: 0,
  };

  readonly versionVector = new VersionVector();

  readonly #options: SyncClientOptions;
  readonly #createSocket: (url: string) => SocketLike;
  #socket: SocketLike | undefined;
  #socketOpen = false;
  #enabled = false;
  #status: SyncStatus = "offline";
  #error: string | undefined;
  #readOnly = false;
  #cursor: number;
  #outbox: OutboxItem[];
  /** How many outbox items (from the front) have been sent on the current connection. */
  #sent = 0;
  #nextClientSeq: number;
  #presence: Uint8Array | undefined;
  readonly #history = new Map<number, { resolve: (v: HistoryVersion) => void; reject: (e: Error) => void }>();
  #nextRequestId = 1;
  #attempt = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: SyncClientOptions) {
    this.#options = options;
    this.#createSocket = options.createSocket ?? defaultSocket;
    this.#cursor = options.initial?.cursor ?? 0;
    this.#outbox = [...(options.initial?.outbox ?? [])];
    this.#nextClientSeq = options.initial?.nextClientSeq ?? 1;
  }

  get status(): SyncStatus {
    return this.#status;
  }

  get pending(): number {
    return this.#outbox.length;
  }

  get cursor(): number {
    return this.#cursor;
  }

  /** Connect, and keep reconnecting until stop(). */
  start(): void {
    if (this.#enabled) return;
    this.#enabled = true;
    this.#error = undefined;
    this.#attempt = 0;
    this.#connect();
  }

  /** Go offline. Local edits keep queueing in the outbox. */
  stop(): void {
    this.#enabled = false;
    clearTimeout(this.#timer);
    const socket = this.#socket;
    this.#socket = undefined;
    this.#socketOpen = false;
    socket?.close(1000, "client stopped");
    this.#failHistory("went offline");
    this.#setStatus("offline");
  }

  #failHistory(reason: string): void {
    for (const pending of this.#history.values()) pending.reject(new Error(`history request failed: ${reason}`));
    this.#history.clear();
  }

  /** Queue a local delta, send it now if connected, and return it (for persistence). */
  push(delta: DocDelta): OutboxItem | undefined {
    if (delta.tree.length === 0 && delta.props.length === 0 && (delta.texts?.length ?? 0) === 0) return undefined;
    for (const ts of timestampsOf(delta)) this.versionVector.observe(ts);
    const item: OutboxItem = { clientSeq: this.#nextClientSeq++, bytes: encodeDelta(delta) };
    this.#outbox.push(item);
    this.#pump();
    this.#emit();
    return item;
  }

  /** Ask the server for the document as it was at server seq `at`. Needs a connection. */
  requestHistory(at: number): Promise<HistoryVersion> {
    if (!this.#socketOpen) return Promise.reject(new Error("history needs a connection"));
    const requestId = this.#nextRequestId++;
    return new Promise((resolve, reject) => {
      this.#history.set(requestId, { resolve, reject });
      this.#send(encodeClientMessage({ type: "history", requestId, at: Math.max(0, Math.floor(at)) }));
    });
  }

  /** Send opaque bytes to one other client in this document. Dropped while offline. */
  signal(to: string, payload: Uint8Array): boolean {
    if (!this.#socketOpen) return false;
    this.#send(encodeClientMessage({ type: "signal", to, payload }));
    return true;
  }

  /** Replace this client's presence. Sent now if connected, and again after every reconnect. */
  setPresence(payload: Uint8Array): void {
    this.#presence = payload;
    if (this.#socketOpen) this.#send(encodeClientMessage({ type: "presence", payload }));
  }

  #connect(): void {
    this.#setStatus("connecting");
    this.stats.connects += 1;
    const socket = this.#createSocket(this.#options.url);
    socket.binaryType = "arraybuffer";
    this.#socket = socket;

    socket.onopen = () => {
      if (this.#socket !== socket) return;
      this.#socketOpen = true;
      this.#send(
        encodeClientMessage({
          type: "hello",
          version: PROTOCOL_VERSION,
          docId: this.#options.docId,
          clientId: this.#options.clientId,
          since: this.#cursor,
          token: this.#options.token ?? "",
        }),
      );
      this.#sent = 0;
      this.#pump();
      if (this.#presence) this.#send(encodeClientMessage({ type: "presence", payload: this.#presence }));
    };
    socket.onmessage = (event) => {
      if (this.#socket !== socket) return;
      const bytes = toBytes(event.data);
      if (!bytes) return;
      this.stats.bytesReceived += bytes.length;
      try {
        this.#handle(decodeServerMessage(bytes));
      } catch (error) {
        console.error("sync: dropping connection after bad server message", error);
        socket.close(4000, "bad server message");
      }
    };
    socket.onclose = () => {
      if (this.#socket !== socket) return;
      this.#socket = undefined;
      this.#socketOpen = false;
      this.#failHistory("connection closed");
      if (this.#enabled) this.#scheduleReconnect();
      else this.#setStatus("offline");
    };
    socket.onerror = () => {
      // A close event always follows; reconnection is handled there.
    };
  }

  #handle(message: ServerMessage): void {
    switch (message.type) {
      case "welcome":
        this.#attempt = 0;
        this.#readOnly = message.readOnly;
        if (message.head < this.#cursor) {
          // Without this, the server's new seqs 1, 2, 3… would all look "already seen"
          // to us and every future edit from others would be silently dropped.
          console.warn(`sync: server head ${message.head} is behind our cursor ${this.#cursor}; it lost data`);
          this.#cursor = message.head;
          this.#options.onServerReset?.(message.head);
        }
        this.#setStatus("online");
        return;
      case "delta":
        this.stats.deltasReceived += 1;
        if (message.serverSeq <= this.#cursor) {
          this.stats.duplicatesIgnored += 1; // already have it
          return;
        }
        // Merge first, then advance: if merging throws, the cursor stays put and the
        // reconnect that follows fetches this delta again instead of skipping it.
        {
          const decoded = decodeDelta(message.delta);
          for (const ts of timestampsOf(decoded)) this.versionVector.observe(ts);
          this.#options.onDelta(decoded, { serverSeq: message.serverSeq, bytes: message.delta });
        }
        this.#cursor = message.serverSeq;
        this.#emit();
        return;
      case "ack":
        {
          // Pushes are processed in order, so an ACK covers every earlier clientSeq too.
          const before = this.#outbox.length;
          this.#outbox = this.#outbox.filter((item) => item.clientSeq > message.clientSeq);
          this.#sent = Math.max(0, this.#sent - (before - this.#outbox.length));
          this.#cursor = Math.max(this.#cursor, message.serverSeq);
          this.#options.onAck?.(message.clientSeq, this.#cursor);
          this.#pump(); // window has room again
          this.#emit();
        }
        return;
      case "signal":
        this.#options.onSignal?.(message.from, message.payload);
        break;
      case "presence":
        this.#options.onPresence?.(message.clientId, message.payload);
        return;
      case "leave":
        this.#options.onPresence?.(message.clientId, null);
        return;
      case "history": {
        const pending = this.#history.get(message.requestId);
        if (!pending) return;
        this.#history.delete(message.requestId);
        pending.resolve({ at: message.at, head: message.head, state: decodeDelta(message.state) });
        return;
      }
      case "error":
        if (message.fatal) {
          this.#error = message.message;
          this.stop();
        } else {
          console.warn(`sync: server warning: ${message.message}`);
        }
    }
  }

  #scheduleReconnect(): void {
    const min = this.#options.minBackoffMs ?? 250;
    const max = this.#options.maxBackoffMs ?? 10_000;
    const delay = Math.min(max, min * 2 ** this.#attempt) * (0.5 + Math.random() * 0.5);
    this.#attempt += 1;
    this.#setStatus("connecting");
    this.#timer = setTimeout(() => {
      if (this.#enabled) this.#connect();
    }, delay);
  }

  /** Send outbox items until the in-flight window is full. */
  #pump(): void {
    if (!this.#socketOpen) return;
    while (this.#sent < this.#outbox.length && this.#sent < PUSH_WINDOW) {
      const item = this.#outbox[this.#sent];
      if (!item) break;
      this.#sendPush(item);
      this.#sent += 1;
    }
  }

  #sendPush(item: OutboxItem): void {
    this.stats.deltasSent += 1;
    this.#send(encodeClientMessage({ type: "push", clientSeq: item.clientSeq, delta: item.bytes }));
  }

  #send(bytes: Uint8Array): void {
    this.stats.bytesSent += bytes.length;
    this.#socket?.send(bytes);
  }

  #setStatus(status: SyncStatus): void {
    this.#status = status;
    this.#emit();
  }

  #emit(): void {
    const base = { status: this.#status, pending: this.#outbox.length, cursor: this.#cursor, readOnly: this.#readOnly };
    this.#options.onState?.(this.#error === undefined ? base : { ...base, error: this.#error });
  }
}
