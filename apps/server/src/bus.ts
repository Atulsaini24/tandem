import { Redis } from "ioredis";
import { DecodeError, Reader, Writer } from "@canvas/sync";

/**
 * How server instances talk to each other. When an instance appends a delta (or sees a
 * presence change), it publishes it; every other instance with clients on that document
 * relays it to them.
 *
 * Messages may arrive late, duplicated or out of order relative to an instance's own
 * appends. Room (room.ts) re-establishes order before anything reaches a client.
 */
export type BusMessage =
  | { readonly kind: "delta"; readonly seq: number; readonly delta: Uint8Array }
  | { readonly kind: "presence"; readonly clientId: string; readonly payload: Uint8Array }
  | { readonly kind: "leave"; readonly clientId: string }
  /** A point-to-point message for a client that may be on another instance. */
  | { readonly kind: "signal"; readonly from: string; readonly to: string; readonly payload: Uint8Array }
  /** "Re-announce your local presences on this document" (a new instance joined it). */
  | { readonly kind: "who" };

export type BusHandler = (message: BusMessage) => void;

export interface Bus {
  readonly instanceId: string;
  publish(docId: string, message: BusMessage): void;
  /** Resolves once messages for this document will be delivered. */
  subscribe(docId: string, handler: BusHandler): Promise<void>;
  unsubscribe(docId: string): Promise<void>;
  close(): Promise<void>;
}

const DELTA = 1;
const PRESENCE = 2;
const LEAVE = 3;
const WHO = 4;
const SIGNAL = 5;

export function encodeBusMessage(from: string, message: BusMessage): Uint8Array {
  const w = new Writer();
  w.str(from);
  switch (message.kind) {
    case "delta":
      w.byte(DELTA);
      w.uint(message.seq);
      w.bytes(message.delta);
      break;
    case "presence":
      w.byte(PRESENCE);
      w.str(message.clientId);
      w.bytes(message.payload);
      break;
    case "leave":
      w.byte(LEAVE);
      w.str(message.clientId);
      break;
    case "who":
      w.byte(WHO);
      break;
    case "signal":
      w.byte(SIGNAL);
      w.str(message.from);
      w.str(message.to);
      w.bytes(message.payload);
      break;
  }
  return w.finish();
}

export function decodeBusMessage(bytes: Uint8Array): { from: string; message: BusMessage } {
  const r = new Reader(bytes);
  const from = r.str();
  const kind = r.byte();
  if (kind === DELTA) return { from, message: { kind: "delta", seq: r.uint(), delta: r.rest() } };
  if (kind === PRESENCE) return { from, message: { kind: "presence", clientId: r.str(), payload: r.rest() } };
  if (kind === LEAVE) {
    const message: BusMessage = { kind: "leave", clientId: r.str() };
    r.end();
    return { from, message };
  }
  if (kind === SIGNAL) return { from, message: { kind: "signal", from: r.str(), to: r.str(), payload: r.rest() } };
  if (kind === WHO) {
    r.end();
    return { from, message: { kind: "who" } };
  }
  throw new DecodeError(`unknown bus message ${kind}`);
}

// ---------------------------------------------------------------------------
// In-memory bus: tests, with optional random delays to force reordering.
// ---------------------------------------------------------------------------

/** A shared "network" that in-process server instances connect to. */
export class MemoryBusHub {
  readonly #subscribers = new Map<string, Map<string, BusHandler>>();
  readonly #maxDelayMs: number;
  readonly #dropRate: number;

  /**
   * maxDelayMs > 0 delivers each message after a random delay: arbitrary reordering.
   * dropRate > 0 loses that fraction of messages, like a fire-and-forget pub/sub can.
   */
  constructor(maxDelayMs = 0, dropRate = 0) {
    this.#maxDelayMs = maxDelayMs;
    this.#dropRate = dropRate;
  }

  connect(instanceId: string): Bus {
    const channels = this.#subscribers;
    const maxDelayMs = this.#maxDelayMs;
    const dropRate = this.#dropRate;
    return {
      instanceId,
      publish(docId, message) {
        // Round-trip the encoding, so tests exercise exactly what Redis would carry.
        const bytes = encodeBusMessage(instanceId, message);
        for (const [subscriber, handler] of channels.get(docId) ?? []) {
          if (subscriber === instanceId) continue;
          if (Math.random() < dropRate) continue;
          const deliver = (): void => handler(decodeBusMessage(bytes).message);
          if (maxDelayMs > 0) setTimeout(deliver, Math.random() * maxDelayMs);
          else queueMicrotask(deliver);
        }
      },
      async subscribe(docId, handler) {
        const subscribers = channels.get(docId) ?? new Map<string, BusHandler>();
        subscribers.set(instanceId, handler);
        channels.set(docId, subscribers);
      },
      async unsubscribe(docId) {
        channels.get(docId)?.delete(instanceId);
      },
      async close() {
        for (const subscribers of channels.values()) subscribers.delete(instanceId);
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Redis pub/sub: one channel per document.
// ---------------------------------------------------------------------------

const CHANNEL_PREFIX = "canvas:doc:";

export class RedisBus implements Bus {
  readonly instanceId: string;
  readonly #pub: Redis;
  readonly #sub: Redis;
  readonly #handlers = new Map<string, BusHandler>();

  private constructor(instanceId: string, pub: Redis, sub: Redis) {
    this.instanceId = instanceId;
    this.#pub = pub;
    this.#sub = sub;
    // A subscribed connection can't run other commands, hence two connections.
    sub.on("messageBuffer", (channel: Buffer, payload: Buffer) => {
      const docId = channel.toString().slice(CHANNEL_PREFIX.length);
      const handler = this.#handlers.get(docId);
      if (!handler) return;
      try {
        const { from, message } = decodeBusMessage(new Uint8Array(payload));
        if (from !== this.instanceId) handler(message);
      } catch (error) {
        console.error("bus: dropping malformed message", error);
      }
    });
  }

  static async connect(url: string, instanceId: string): Promise<RedisBus> {
    const pub = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3 });
    const sub = new Redis(url, { lazyConnect: true });
    await Promise.all([pub.connect(), sub.connect()]);
    return new RedisBus(instanceId, pub, sub);
  }

  publish(docId: string, message: BusMessage): void {
    void this.#pub
      .publish(CHANNEL_PREFIX + docId, Buffer.from(encodeBusMessage(this.instanceId, message)))
      .catch((error: unknown) => console.error("bus: publish failed", error));
  }

  async subscribe(docId: string, handler: BusHandler): Promise<void> {
    this.#handlers.set(docId, handler);
    await this.#sub.subscribe(CHANNEL_PREFIX + docId);
  }

  async unsubscribe(docId: string): Promise<void> {
    this.#handlers.delete(docId);
    await this.#sub.unsubscribe(CHANNEL_PREFIX + docId);
  }

  async close(): Promise<void> {
    this.#handlers.clear();
    await Promise.all([this.#pub.quit(), this.#sub.quit()]);
  }
}
