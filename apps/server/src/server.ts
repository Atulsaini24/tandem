import { createServer } from "node:http";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import {
  DecodeError,
  PROTOCOL_VERSION,
  decodeClientMessage,
  decodeDelta,
  encodeServerMessage,
  timestampsOf,
  type ClientMessage,
  type ServerMessage,
} from "@canvas/sync";
import type { Store } from "./store.js";

export interface SyncServerOptions {
  readonly store: Store;
  readonly port?: number;
  readonly host?: string;
  /** Reject ops stamped further than this in the future (protects every HLC). */
  readonly maxDriftMs?: number;
  readonly maxPayloadBytes?: number;
  readonly now?: () => number;
}

export interface SyncServer {
  readonly port: number;
  readonly stats: { connections: number; pushes: number; duplicates: number; rejected: number };
  close(): Promise<void>;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Presence is a name, a color, a point and a capped selection: a few KB at most. */
const MAX_PRESENCE_BYTES = 16 * 1024;

/** Serializes all work for one document, so serverSeq order = send order to every client. */
class Room {
  readonly clients = new Set<Connection>();
  #queue: Promise<void> = Promise.resolve();

  constructor(readonly docId: string) {}

  run(task: () => Promise<void>): Promise<void> {
    const next = this.#queue.then(task);
    this.#queue = next.catch((error: unknown) => console.error(`room ${this.docId}:`, error));
    return next;
  }
}

class Connection {
  room: Room | undefined;
  clientId = "";
  /** Latest presence payload (opaque bytes), replayed to clients who join later. */
  presence: Uint8Array | undefined;
  constructor(readonly socket: WebSocket) {}

  send(message: ServerMessage): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(encodeServerMessage(message));
  }

  sendRaw(bytes: Uint8Array): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(bytes);
  }

  reject(message: string): void {
    this.send({ type: "error", fatal: true, message });
    this.socket.close(4400, message.slice(0, 120));
  }
}

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

export async function startSyncServer(options: SyncServerOptions): Promise<SyncServer> {
  const { store } = options;
  const maxDriftMs = options.maxDriftMs ?? 60_000;
  const now = options.now ?? Date.now;
  const rooms = new Map<string, Room>();
  const stats = { connections: 0, pushes: 0, duplicates: 0, rejected: 0 };

  const http = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, store: store.kind, rooms: rooms.size, ...stats }));
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ server: http, maxPayload: options.maxPayloadBytes ?? 16 * 1024 * 1024 });

  function roomFor(docId: string): Room {
    let room = rooms.get(docId);
    if (!room) {
      room = new Room(docId);
      rooms.set(docId, room);
    }
    return room;
  }

  function hello(conn: Connection, message: Extract<ClientMessage, { type: "hello" }>): void {
    if (conn.room) return conn.reject("hello sent twice");
    if (message.version !== PROTOCOL_VERSION) return conn.reject(`unsupported protocol version ${message.version}`);
    if (!ID_PATTERN.test(message.docId)) return conn.reject("invalid document id");
    if (!ID_PATTERN.test(message.clientId)) return conn.reject("invalid client id");
    const room = roomFor(message.docId);
    conn.room = room;
    conn.clientId = message.clientId;
    // Inside the room queue: the backlog and joining the broadcast set happen with no
    // append in between, so the client can't miss or double-receive a delta.
    void room.run(async () => {
      for (const entry of await store.readSince(room.docId, message.since)) {
        conn.send({ type: "delta", serverSeq: entry.seq, delta: entry.delta });
      }
      room.clients.add(conn);
      conn.send({ type: "welcome", head: await store.head(room.docId) });
      // Who's already here: their latest cursors/selections.
      for (const other of room.clients) {
        if (other !== conn && other.presence) {
          conn.send({ type: "presence", clientId: other.clientId, payload: other.presence });
        }
      }
    });
  }

  /**
   * Presence is relayed, never stored or ordered with deltas: it's ephemeral and only the
   * latest value matters. The server doesn't decode it; clients decode defensively.
   */
  function presence(conn: Connection, payload: Uint8Array): void {
    const room = conn.room;
    if (!room) return conn.reject("presence before hello");
    if (payload.length > MAX_PRESENCE_BYTES) return conn.reject("presence too large");
    conn.presence = payload;
    const relay = encodeServerMessage({ type: "presence", clientId: conn.clientId, payload });
    for (const other of room.clients) if (other !== conn) other.sendRaw(relay);
  }

  function leave(conn: Connection): void {
    const room = conn.room;
    if (!room) return;
    room.clients.delete(conn);
    if (!conn.presence) return;
    const relay = encodeServerMessage({ type: "leave", clientId: conn.clientId });
    for (const other of room.clients) other.sendRaw(relay);
  }

  /** Validate untrusted bytes before they reach the log. Returns an error message or undefined. */
  function validate(conn: Connection, deltaBytes: Uint8Array): string | undefined {
    let timestamps;
    try {
      timestamps = timestampsOf(decodeDelta(deltaBytes));
    } catch (error) {
      return error instanceof DecodeError ? `malformed delta: ${error.message}` : "malformed delta";
    }
    const limit = now() + maxDriftMs;
    for (const ts of timestamps) {
      // A client may only author ops as itself — no forging other replicas' edits.
      if (ts.replica !== conn.clientId) return "delta contains ops from another replica";
      // A timestamp far in the future would drag every client's HLC forward forever.
      if (ts.wall > limit) return "timestamp too far in the future (check the device clock)";
    }
    return undefined;
  }

  function push(conn: Connection, message: Extract<ClientMessage, { type: "push" }>): void {
    const room = conn.room;
    if (!room) return conn.reject("push before hello");
    const problem = validate(conn, message.delta);
    if (problem) {
      stats.rejected += 1;
      return conn.reject(problem);
    }
    void room.run(async () => {
      const result = await store.append(room.docId, conn.clientId, message.clientSeq, message.delta);
      if (result === "duplicate") {
        // Everything up to head has already been sent on this connection (backlog/live),
        // so acking at head can't make the client skip a delta.
        stats.duplicates += 1;
        conn.send({ type: "ack", clientSeq: message.clientSeq, serverSeq: await store.head(room.docId) });
        return;
      }
      stats.pushes += 1;
      conn.send({ type: "ack", clientSeq: message.clientSeq, serverSeq: result });
      const relay = encodeServerMessage({ type: "delta", serverSeq: result, delta: message.delta });
      for (const other of room.clients) if (other !== conn) other.sendRaw(relay);
    });
  }

  wss.on("connection", (socket) => {
    stats.connections += 1;
    const conn = new Connection(socket);
    socket.on("message", (data, isBinary) => {
      if (!isBinary) return conn.reject("binary frames only");
      let message: ClientMessage;
      try {
        message = decodeClientMessage(toBytes(data));
      } catch {
        stats.rejected += 1;
        return conn.reject("malformed message");
      }
      if (message.type === "hello") hello(conn, message);
      else if (message.type === "push") push(conn, message);
      else presence(conn, message.payload);
    });
    socket.on("close", () => leave(conn));
    socket.on("error", () => socket.terminate());
  });

  // No host by default: Node then listens on "::" (dual-stack), so both 127.0.0.1 and
  // ::1 work. Browsers resolve "localhost" to ::1 first; binding 0.0.0.0 broke that.
  await new Promise<void>((resolve) => {
    if (options.host === undefined) http.listen(options.port ?? 0, resolve);
    else http.listen(options.port ?? 0, options.host, resolve);
  });
  const address = http.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    port,
    stats,
    close: async () => {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
