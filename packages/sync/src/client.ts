import type { DocDelta } from "@canvas/doc";
import { decodeDelta, encodeDelta } from "./codec.js";
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
  readonly error?: string;
}

export interface SyncClientOptions {
  readonly url: string;
  readonly docId: string;
  readonly clientId: string;
  /** A delta from another client, to merge into the local document. */
  readonly onDelta: (delta: DocDelta) => void;
  readonly onState?: (state: SyncState) => void;
  readonly createSocket?: (url: string) => SocketLike;
  readonly minBackoffMs?: number;
  readonly maxBackoffMs?: number;
}

interface OutboxItem {
  readonly clientSeq: number;
  readonly bytes: Uint8Array;
}

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

  readonly #options: SyncClientOptions;
  readonly #createSocket: (url: string) => SocketLike;
  #socket: SocketLike | undefined;
  #socketOpen = false;
  #enabled = false;
  #status: SyncStatus = "offline";
  #error: string | undefined;
  #cursor = 0;
  #outbox: OutboxItem[] = [];
  #nextClientSeq = 1;
  #attempt = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: SyncClientOptions) {
    this.#options = options;
    this.#createSocket = options.createSocket ?? defaultSocket;
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
    this.#setStatus("offline");
  }

  /** Queue a local delta and send it now if connected. */
  push(delta: DocDelta): void {
    if (delta.tree.length === 0 && delta.props.length === 0) return;
    const item: OutboxItem = { clientSeq: this.#nextClientSeq++, bytes: encodeDelta(delta) };
    this.#outbox.push(item);
    if (this.#socketOpen) this.#sendPush(item);
    this.#emit();
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
        }),
      );
      for (const item of this.#outbox) this.#sendPush(item);
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
        this.#setStatus("online");
        return;
      case "delta":
        this.stats.deltasReceived += 1;
        if (message.serverSeq <= this.#cursor) {
          this.stats.duplicatesIgnored += 1; // already have it
          return;
        }
        this.#options.onDelta(decodeDelta(message.delta));
        this.#cursor = message.serverSeq;
        this.#emit();
        return;
      case "ack":
        // Pushes are processed in order, so an ACK covers every earlier clientSeq too.
        this.#outbox = this.#outbox.filter((item) => item.clientSeq > message.clientSeq);
        this.#cursor = Math.max(this.#cursor, message.serverSeq);
        this.#emit();
        return;
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
    const base = { status: this.#status, pending: this.#outbox.length, cursor: this.#cursor };
    this.#options.onState?.(this.#error === undefined ? base : { ...base, error: this.#error });
  }
}
