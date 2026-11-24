import { createServer } from "node:http";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { CanvasDocument } from "@canvas/doc";
import {
  DecodeError,
  PROTOCOL_VERSION,
  decodeClientMessage,
  decodeDelta,
  encodeDelta,
  encodeServerMessage,
  textAuthorReplicasOf,
  timestampsOf,
  type ClientMessage,
  type ServerMessage,
} from "@canvas/sync";
import { signToken, verifyToken, type Role } from "./auth.js";
import type { Bus, BusMessage } from "./bus.js";
import { TokenBucket } from "./rate-limit.js";
import { Room, type RoomClient } from "./room.js";
import type { Store } from "./store.js";

export interface RateLimits {
  /** Pushes per second (sustained) and burst, per connection. */
  readonly pushesPerSec: number;
  readonly pushBurst: number;
  readonly presencePerSec: number;
  readonly historyPerSec: number;
}

export const DEFAULT_LIMITS: RateLimits = { pushesPerSec: 200, pushBurst: 400, presencePerSec: 60, historyPerSec: 20 };

export interface SyncServerOptions {
  readonly store: Store;
  /** Connects instances: without one, this server must be the only one for its documents. */
  readonly bus?: Bus;
  /** When set, every HELLO must carry a valid token (see auth.ts). */
  readonly authSecret?: string;
  readonly limits?: RateLimits;
  readonly port?: number;
  readonly host?: string;
  /** Reject ops stamped further than this in the future (protects every HLC). */
  readonly maxDriftMs?: number;
  readonly maxPayloadBytes?: number;
  readonly now?: () => number;
  /** Write a snapshot of the merged state every N deltas. */
  readonly snapshotEvery?: number;
  /** Catch a client up with a snapshot only if it's at least this many deltas behind it. */
  readonly snapshotMinGap?: number;
  /** Evict an idle room (and unsubscribe from the bus) this many ms after its last client leaves. */
  readonly roomIdleMs?: number;
}

export interface SyncStats {
  connections: number;
  pushes: number;
  duplicates: number;
  rejected: number;
  rateLimited: number;
  unauthorized: number;
  snapshotsWritten: number;
  snapshotsSent: number;
  historyServed: number;
  fromBus: number;
  /** Store transactions used for appends (pushes / batches = average group-commit size). */
  batches: number;
}

export interface SyncServer {
  readonly port: number;
  readonly stats: SyncStats;
  /** Number of active rooms currently loaded in memory. */
  roomCount(): number;
  /** Ordering diagnostics summed over rooms: deltas that arrived out of order, gaps filled from the store. */
  ordering(): { outOfOrder: number; gapFills: number };
  close(): Promise<void>;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Presence is a name, a color, a point and a capped selection: a few KB at most. */
const MAX_PRESENCE_BYTES = 16 * 1024;
/** An SDP offer is a few KB; leave room for big ones (many codecs, many candidates). */
const MAX_SIGNAL_BYTES = 64 * 1024;

class Connection implements RoomClient {
  room: Room | undefined;
  clientId = "";
  role: Role = "editor";
  presence: Uint8Array | undefined;
  readonly pushes: TokenBucket;
  readonly presenceBucket: TokenBucket;
  readonly historyBucket: TokenBucket;
  readonly signalBucket: TokenBucket;
  /** Pushes waiting for rate-limit tokens, processed in arrival order. */
  pushChain: Promise<void> = Promise.resolve();
  queuedPushes = 0;

  constructor(
    readonly socket: WebSocket,
    limits: RateLimits,
  ) {
    this.pushes = new TokenBucket(limits.pushesPerSec, limits.pushBurst);
    this.presenceBucket = new TokenBucket(limits.presencePerSec, limits.presencePerSec);
    this.historyBucket = new TokenBucket(limits.historyPerSec, limits.historyPerSec);
    // Call setup is bursty (an offer plus a dozen ICE candidates) but rare.
    this.signalBucket = new TokenBucket(limits.presencePerSec, limits.presencePerSec * 4);
  }

  send(message: ServerMessage): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(encodeServerMessage(message));
  }

  sendRaw(bytes: Uint8Array): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(bytes);
  }

  /** Fatal: the client stops reconnecting (bad credentials, forged data, ...). */
  reject(message: string): void {
    this.send({ type: "error", fatal: true, message });
    this.socket.close(4400, message.slice(0, 120));
  }

  /** Not fatal: the client backs off, reconnects and resends its outbox. */
  slowDown(): void {
    this.send({ type: "error", fatal: false, message: "rate limit: slow down" });
    this.socket.close(4429, "rate limited");
  }
}

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

export async function startSyncServer(options: SyncServerOptions): Promise<SyncServer> {
  const { store, bus, authSecret } = options;
  const limits = options.limits ?? DEFAULT_LIMITS;
  const maxDriftMs = options.maxDriftMs ?? 60_000;
  const now = options.now ?? Date.now;
  const rooms = new Map<string, Room>();
  const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const snapshotEvery = options.snapshotEvery ?? 500;
  const snapshotMinGap = options.snapshotMinGap ?? 50;
  const roomIdleMs = options.roomIdleMs ?? 30_000;
  const stats: SyncStats = {
    connections: 0,
    pushes: 0,
    duplicates: 0,
    rejected: 0,
    rateLimited: 0,
    unauthorized: 0,
    snapshotsWritten: 0,
    snapshotsSent: 0,
    historyServed: 0,
    fromBus: 0,
    batches: 0,
  };

  const http = createServer((req, res) => {
    if (req.url === "/health") {
      const memory = process.memoryUsage();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          store: store.kind,
          instance: bus?.instanceId ?? "standalone",
          rooms: rooms.size,
          clients: [...rooms.values()].reduce((n, room) => n + room.clients.size, 0),
          rssMb: Math.round(memory.rss / 1e6),
          ...stats,
        }),
      );
      return;
    }
    if (req.url === "/share") {
      handleShare(req, res);
      return;
    }
    res.writeHead(404).end();
  });

  /**
   * POST /share {docId, token, role} → a fresh token for that document and role.
   * Only an EDITOR of the document may mint links, and a share link never grants more
   * than the caller has. Without AUTH_SECRET the server is open, so links need no token.
   */
  function handleShare(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): void {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST" };
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors).end();
      return;
    }
    const reply = (status: number, body: unknown): void => {
      res.writeHead(status, { ...cors, "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "POST") return reply(405, { error: "POST only" });
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      raw += chunk;
      if (raw.length > 4_096) req.destroy();
    });
    req.on("end", () => {
      let body: { docId?: unknown; token?: unknown; role?: unknown };
      try {
        body = JSON.parse(raw) as typeof body;
      } catch {
        return reply(400, { error: "bad JSON" });
      }
      const { docId, token, role } = body;
      if (typeof docId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(docId)) return reply(400, { error: "bad docId" });
      if (role !== "viewer" && role !== "editor") return reply(400, { error: "role must be viewer or editor" });
      if (!authSecret) return reply(200, { auth: false });
      const claims = typeof token === "string" ? verifyToken(authSecret, token, docId, now()) : "missing token";
      if (typeof claims === "string") return reply(403, { error: claims });
      if (claims.role !== "editor") return reply(403, { error: "only editors can share" });
      const exp = Math.min(claims.exp, Math.floor(now() / 1000) + 30 * 24 * 3600);
      reply(200, { auth: true, token: signToken(authSecret, { doc: docId, sub: `${claims.sub}/share`, role, exp }) });
    });
  }
  const wss = new WebSocketServer({ server: http, maxPayload: options.maxPayloadBytes ?? 16 * 1024 * 1024 });

  // --- rooms + bus ---------------------------------------------------------

  function onBus(room: Room, message: BusMessage): void {
    switch (message.kind) {
      case "delta":
        stats.fromBus += 1;
        void room.run(() => room.offer(message.seq, message.delta));
        return;
      case "presence": {
        room.remotePresence.set(message.clientId, message.payload);
        const relay = encodeServerMessage({ type: "presence", clientId: message.clientId, payload: message.payload });
        for (const client of room.clients) client.sendRaw(relay);
        return;
      }
      case "leave": {
        room.remotePresence.delete(message.clientId);
        const relay = encodeServerMessage({ type: "leave", clientId: message.clientId });
        for (const client of room.clients) client.sendRaw(relay);
        return;
      }
      case "signal": {
        const relay = encodeServerMessage({ type: "signal", from: message.from, payload: message.payload });
        for (const client of room.clients) if (client.clientId === message.to) client.sendRaw(relay);
        return;
      }
      case "who":
        for (const client of room.clients) {
          if (client.presence) bus?.publish(room.docId, { kind: "presence", clientId: client.clientId, payload: client.presence });
        }
    }
  }

  function cancelEviction(docId: string): void {
    const timer = idleTimers.get(docId);
    if (timer) {
      clearTimeout(timer);
      idleTimers.delete(docId);
    }
  }

  function scheduleEviction(room: Room): void {
    if (roomIdleMs <= 0) return;
    cancelEviction(room.docId);
    const timer = setTimeout(() => {
      idleTimers.delete(room.docId);
      if (room.clients.size > 0 || appendQueues.has(room) || rooms.get(room.docId) !== room) return;
      rooms.delete(room.docId);
      room.close();
      void bus?.unsubscribe(room.docId);
    }, roomIdleMs);
    timer.unref();
    idleTimers.set(room.docId, timer);
  }

  function roomFor(docId: string): Room {
    cancelEviction(docId);
    let room = rooms.get(docId);
    if (!room) {
      room = new Room(
        docId,
        store,
        async (created) => {
          if (!bus) return;
          await bus.subscribe(docId, (message) => onBus(created, message));
          bus.publish(docId, { kind: "who" }); // learn who's connected elsewhere
        },
        // Only needed when other instances append too (a lone server sees every append).
        { tailCheck: bus !== undefined },
      );
      rooms.set(docId, room);
    }
    return room;
  }

  // --- handlers --------------------------------------------------------------

  function hello(conn: Connection, message: Extract<ClientMessage, { type: "hello" }>): void {
    if (conn.room) return conn.reject("hello sent twice");
    if (message.version !== PROTOCOL_VERSION) return conn.reject(`unsupported protocol version ${message.version}`);
    if (!ID_PATTERN.test(message.docId)) return conn.reject("invalid document id");
    if (!ID_PATTERN.test(message.clientId)) return conn.reject("invalid client id");
    if (authSecret) {
      const claims = verifyToken(authSecret, message.token, message.docId, now());
      if (typeof claims === "string") {
        stats.unauthorized += 1;
        return conn.reject(`unauthorized: ${claims}`);
      }
      conn.role = claims.role;
    }
    const room = roomFor(message.docId);
    conn.room = room;
    conn.clientId = message.clientId;
    // Inside the room queue: backlog up to `delivered`, then join the ordered stream.
    // Nothing can be delivered in between, so the client neither misses nor repeats a seq.
    void room.run(async () => {
      let from = message.since;
      // Far behind (or brand new)? Send the latest snapshot as one big delta, then only
      // the tail after it. A snapshot is just the merge of everything up to its seq, so to
      // the client it's an ordinary (idempotent) delta with serverSeq = snapshot.seq.
      const snapshot = await store.snapshot(room.docId, room.delivered);
      if (snapshot && snapshot.seq - message.since >= snapshotMinGap) {
        conn.send({ type: "delta", serverSeq: snapshot.seq, delta: snapshot.state });
        stats.snapshotsSent += 1;
        from = snapshot.seq;
      }
      if (from < room.delivered) {
        for (const entry of await store.readSince(room.docId, from, room.delivered)) {
          conn.send({ type: "delta", serverSeq: entry.seq, delta: entry.delta });
        }
      }
      room.clients.add(conn);
      conn.send({ type: "welcome", head: room.delivered, readOnly: conn.role === "viewer" });
      // Who's already here, on this instance and on others.
      for (const other of room.clients) {
        if (other !== conn && other.presence) conn.send({ type: "presence", clientId: other.clientId, payload: other.presence });
      }
      for (const [clientId, payload] of room.remotePresence) conn.send({ type: "presence", clientId, payload });
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
    if (!conn.presenceBucket.take()) return; // latest-wins data: dropping extras is fine
    conn.presence = payload;
    const relay = encodeServerMessage({ type: "presence", clientId: conn.clientId, payload });
    for (const other of room.clients) if (other !== conn) other.sendRaw(relay);
    bus?.publish(room.docId, { kind: "presence", clientId: conn.clientId, payload });
  }

  /**
   * Signals go to exactly one client: on this instance if it's here, else over the bus.
   * Like presence they're opaque to the server, never stored, and dropped if nobody has
   * that id. The sender can't pick an arbitrary "from": it's always its own id.
   */
  function signal(conn: Connection, to: string, payload: Uint8Array): void {
    const room = conn.room;
    if (!room) return conn.reject("signal before hello");
    if (payload.length > MAX_SIGNAL_BYTES) return conn.reject("signal too large");
    if (!conn.signalBucket.take()) return;
    const relay = encodeServerMessage({ type: "signal", from: conn.clientId, payload });
    let local = false;
    for (const other of room.clients) {
      if (other !== conn && other.clientId === to) {
        other.sendRaw(relay);
        local = true;
      }
    }
    if (!local) bus?.publish(room.docId, { kind: "signal", from: conn.clientId, to, payload });
  }

  function leave(conn: Connection): void {
    const room = conn.room;
    if (!room) return;
    room.clients.delete(conn);
    if (room.clients.size === 0) scheduleEviction(room);
    if (!conn.presence) return;
    const relay = encodeServerMessage({ type: "leave", clientId: conn.clientId });
    for (const other of room.clients) other.sendRaw(relay);
    bus?.publish(room.docId, { kind: "leave", clientId: conn.clientId });
  }

  /** Validate untrusted bytes before they reach the log. Returns an error message or undefined. */
  function validate(conn: Connection, deltaBytes: Uint8Array): string | undefined {
    let decoded;
    try {
      decoded = decodeDelta(deltaBytes);
    } catch (error) {
      return error instanceof DecodeError ? `malformed delta: ${error.message}` : "malformed delta";
    }
    const timestamps = timestampsOf(decoded);
    const limit = now() + maxDriftMs;
    for (const ts of timestamps) {
      // A client may only author ops as itself — no forging other replicas' edits.
      if (ts.replica !== conn.clientId) return "delta contains ops from another replica";
      // A timestamp far in the future would drag every client's HLC forward forever.
      if (ts.wall > limit) return "timestamp too far in the future (check the device clock)";
    }
    for (const replica of textAuthorReplicasOf(decoded)) {
      if (replica !== conn.clientId) return "delta contains text ops from another replica";
    }
    return undefined;
  }

  function push(conn: Connection, message: Extract<ClientMessage, { type: "push" }>): void {
    const room = conn.room;
    if (!room) return conn.reject("push before hello");
    if (conn.role === "viewer") {
      stats.unauthorized += 1;
      return conn.reject("read-only access: this token can't edit");
    }
    const problem = validate(conn, message.delta);
    if (problem) {
      stats.rejected += 1;
      return conn.reject(problem);
    }
    // Rate limiting is BACKPRESSURE: over-limit pushes wait (in order) for tokens rather
    // than being dropped, because a dropped push stays in the client's outbox and comes
    // back on reconnect. Rejecting caused a livelock: resends were duplicates that ate
    // the budget before anything new got through. Only a client queueing far more than an
    // honest one ever can (its in-flight window is 64) is disconnected.
    if (conn.queuedPushes >= Math.max(limits.pushBurst * 2, 128)) {
      stats.rateLimited += 1;
      return conn.slowDown();
    }
    conn.queuedPushes += 1;
    if (conn.pushes.available() < 1) stats.rateLimited += 1; // this one will have to wait
    conn.pushChain = conn.pushChain.then(async () => {
      await conn.pushes.acquire();
      conn.queuedPushes -= 1;
      enqueueAppend(conn, room, message);
    });
  }

  /**
   * Group commit. Pushes queue per room; one room task appends everything queued so far
   * in a single store transaction. While that transaction runs, new pushes collect for
   * the next one, so the batch size grows with load on its own.
   */
  const appendQueues = new Map<Room, Array<{ conn: Connection; clientSeq: number; delta: Uint8Array }>>();

  function enqueueAppend(conn: Connection, room: Room, message: Extract<ClientMessage, { type: "push" }>): void {
    let queue = appendQueues.get(room);
    if (!queue) {
      queue = [];
      appendQueues.set(room, queue);
      void room.run(() => drainAppends(room));
    }
    queue.push({ conn, clientSeq: message.clientSeq, delta: message.delta });
  }

  async function drainAppends(room: Room): Promise<void> {
    const batch = appendQueues.get(room) ?? [];
    appendQueues.delete(room); // pushes arriving from now on start the next batch
    const results = await store.appendBatch(
      room.docId,
      batch.map((item) => ({ clientId: item.conn.clientId, clientSeq: item.clientSeq, delta: item.delta })),
    );
    stats.batches += 1;
    let snapshotAt: number | undefined;
    results.forEach((result, i) => {
      const item = batch[i];
      if (!item) return;
      if (result === "duplicate") {
        // Everything up to `delivered` has gone out on this connection, so acking there
        // can't make the client skip a delta.
        stats.duplicates += 1;
        item.conn.send({ type: "ack", clientSeq: item.clientSeq, serverSeq: room.delivered });
        return;
      }
      stats.pushes += 1;
      bus?.publish(room.docId, { kind: "delta", seq: result, delta: item.delta });
      room.offer(result, item.delta, { client: item.conn, clientSeq: item.clientSeq });
      if (result % snapshotEvery === 0) snapshotAt = result;
    });
    if (snapshotAt !== undefined) {
      await store.putSnapshot(room.docId, { seq: snapshotAt, state: await stateAt(room.docId, snapshotAt) });
      stats.snapshotsWritten += 1;
    }
  }

  /**
   * The merged document at `seq`: nearest snapshot at or before it, plus a replay of
   * the deltas after it. At most `snapshotEvery` deltas are replayed.
   */
  async function stateAt(docId: string, seq: number): Promise<Uint8Array> {
    const doc = new CanvasDocument("server"); // never writes, only merges
    const snapshot = await store.snapshot(docId, seq);
    if (snapshot) doc.merge(decodeDelta(snapshot.state));
    for (const entry of await store.readSince(docId, snapshot?.seq ?? 0, seq)) doc.merge(decodeDelta(entry.delta));
    return encodeDelta(doc.state);
  }

  function history(conn: Connection, message: Extract<ClientMessage, { type: "history" }>): void {
    const room = conn.room;
    if (!room) return conn.reject("history before hello");
    if (!conn.historyBucket.take()) {
      stats.rateLimited += 1;
      return; // the client's request fails when it disconnects/retries; the UI asks again
    }
    void room.run(async () => {
      const head = room.delivered;
      const at = Math.min(message.at, head);
      conn.send({ type: "history", requestId: message.requestId, at, head, state: await stateAt(room.docId, at) });
      stats.historyServed += 1;
    });
  }

  wss.on("connection", (socket) => {
    stats.connections += 1;
    const conn = new Connection(socket, limits);
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
      else if (message.type === "history") history(conn, message);
      else if (message.type === "signal") signal(conn, message.to, message.payload);
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
    roomCount: () => rooms.size,
    ordering: () =>
      [...rooms.values()].reduce(
        (sum, room) => ({ outOfOrder: sum.outOfOrder + room.stats.outOfOrder, gapFills: sum.gapFills + room.stats.gapFills }),
        { outOfOrder: 0, gapFills: 0 },
      ),
    close: async () => {
      for (const timer of idleTimers.values()) clearTimeout(timer);
      idleTimers.clear();
      for (const client of wss.clients) client.terminate();
      for (const room of rooms.values()) {
        room.close();
        await bus?.unsubscribe(room.docId);
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
