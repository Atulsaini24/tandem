import { afterEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { CanvasDocument, type DocDelta, type ShapeProps } from "@canvas/doc";
import {
  PROTOCOL_VERSION,
  SyncClient,
  decodeServerMessage,
  encodeClientMessage,
  encodeDelta,
  type ServerMessage,
} from "@canvas/sync";
import { startSyncServer, type SyncServer } from "../src/server.js";
import { MemoryStore } from "../src/store.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const servers: SyncServer[] = [];
const clients: SyncClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.stop();
  for (const server of servers.splice(0)) await server.close();
});

async function serve(store = new MemoryStore(), port = 0): Promise<SyncServer> {
  const server = await startSyncServer({ store, port, host: "127.0.0.1" });
  servers.push(server);
  return server;
}

interface Peer {
  readonly doc: CanvasDocument;
  readonly client: SyncClient;
  edit(make: (doc: CanvasDocument) => DocDelta): void;
}

function peer(server: SyncServer, name: string, docId = "doc"): Peer {
  const doc = new CanvasDocument(name);
  const client = new SyncClient({
    url: `ws://127.0.0.1:${server.port}`,
    docId,
    clientId: name,
    onDelta: (delta) => doc.merge(delta),
    minBackoffMs: 10,
    maxBackoffMs: 50,
  });
  clients.push(client);
  client.start();
  return { doc, client, edit: (make) => client.push(make(doc)) };
}

async function until(condition: () => boolean, what: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Every peer online with an empty outbox and an identical document. */
async function converged(...peers: Peer[]): Promise<void> {
  const same = (): boolean => {
    const first = JSON.stringify(peers[0]?.doc.shapes());
    return peers.every((p) => JSON.stringify(p.doc.shapes()) === first);
  };
  await until(() => peers.every((p) => p.client.status === "online" && p.client.pending === 0) && same(), "convergence");
}

const rect = (x = 0): ShapeProps => ({ kind: "rect", x, y: 0, w: 10, h: 10, fill: 0x2f63ff });

/** A bare WebSocket speaking the protocol by hand, for adversarial tests. */
async function rawSocket(server: SyncServer): Promise<{ send(bytes: Uint8Array): void; received: ServerMessage[]; closed: () => boolean }> {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
  socket.binaryType = "arraybuffer";
  const received: ServerMessage[] = [];
  let closed = false;
  socket.onmessage = (event) => received.push(decodeServerMessage(new Uint8Array(event.data as ArrayBuffer)));
  socket.onclose = () => (closed = true);
  await new Promise((resolve) => (socket.onopen = resolve));
  return { send: (bytes) => socket.send(bytes), received, closed: () => closed };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sync server", () => {
  it("relays edits live between two clients", async () => {
    const server = await serve();
    const alice = peer(server, "alice");
    const bob = peer(server, "bob");
    await converged(alice, bob);
    alice.edit((d) => d.createShapes([{ id: "s1", props: rect() }]));
    bob.edit((d) => d.createShapes([{ id: "s2", props: rect(50) }]));
    await converged(alice, bob);
    expect(bob.doc.shapes().map((s) => s.id).sort()).toEqual(["s1", "s2"]);
  });

  it("GATE: offline edits sync after reconnect, sending only the missing changes", async () => {
    const server = await serve();
    const alice = peer(server, "alice");
    const bob = peer(server, "bob");
    alice.edit((d) => d.createShapes([{ id: "s1", props: rect() }, { id: "s2", props: rect() }]));
    await converged(alice, bob);

    bob.client.stop(); // Bob goes offline
    for (let i = 1; i <= 3; i++) alice.edit((d) => d.updateShapes([{ id: "s1", patch: { x: i * 100 } }]));
    bob.edit((d) => d.updateShapes([{ id: "s2", patch: { fill: 0xff0000 } }]));
    bob.edit((d) => d.createShapes([{ id: "s3", props: rect(7) }]));
    expect(bob.client.pending).toBe(2);
    await until(() => alice.client.pending === 0, "alice flushed");

    const bobBefore = { ...bob.client.stats };
    const aliceBefore = { ...alice.client.stats };
    bob.client.start(); // back online
    await converged(alice, bob);

    // Server → Bob: exactly Alice's 3 offline-period deltas, not the whole history (5).
    // Counted on the wire, before the client's own already-seen filter.
    expect(bob.client.stats.deltasReceived - bobBefore.deltasReceived).toBe(3);
    expect(bob.client.stats.duplicatesIgnored).toBe(0);
    // Bob → server: exactly his 2 queued deltas.
    expect(bob.client.stats.deltasSent - bobBefore.deltasSent).toBe(2);
    // Server → Alice: exactly Bob's 2.
    expect(alice.client.stats.deltasReceived - aliceBefore.deltasReceived).toBe(2);

    expect(bob.doc.shape("s1")?.x).toBe(300);
    expect(alice.doc.shape("s2")?.fill).toBe(0xff0000);
    expect(alice.doc.shape("s3")).toBeDefined();
  });

  it("a late joiner gets the full history, and it survives a server restart", async () => {
    const store = new MemoryStore();
    const first = await serve(store);
    const alice = peer(first, "alice");
    alice.edit((d) => d.createShapes([{ id: "s1", props: rect() }]));
    alice.edit((d) => d.updateShapes([{ id: "s1", patch: { x: 42 } }]));
    await converged(alice);
    alice.client.stop();
    await first.close();
    servers.splice(servers.indexOf(first), 1);

    const second = await serve(store);
    const carol = peer(second, "carol");
    await until(() => carol.doc.shape("s1")?.x === 42, "carol receives history");
  });

  it("reconnects by itself after the server restarts and flushes its outbox", async () => {
    const store = new MemoryStore();
    const first = await serve(store);
    const port = first.port;
    const alice = peer(first, "alice");
    await converged(alice);

    await first.close();
    servers.splice(servers.indexOf(first), 1);
    await until(() => alice.client.status !== "online", "alice notices");
    alice.edit((d) => d.createShapes([{ id: "made-offline", props: rect() }]));
    expect(alice.client.pending).toBe(1);

    const second = await serve(store, port);
    const bob = peer(second, "bob");
    await converged(alice, bob);
    expect(bob.doc.shape("made-offline")).toBeDefined();
  });

  it("stores a resent push once (ACK lost) and acks both", async () => {
    const store = new MemoryStore();
    const server = await serve(store);
    const raw = await rawSocket(server);
    const doc = new CanvasDocument("eve");
    const delta = encodeDelta(doc.createShapes([{ id: "s", props: rect() }]));
    raw.send(encodeClientMessage({ type: "hello", version: PROTOCOL_VERSION, docId: "doc", clientId: "eve", since: 0, token: "" }));
    raw.send(encodeClientMessage({ type: "push", clientSeq: 1, delta }));
    raw.send(encodeClientMessage({ type: "push", clientSeq: 1, delta }));
    await until(() => raw.received.filter((m) => m.type === "ack").length === 2, "two acks");
    expect(store.size("doc")).toBe(1);
    expect(server.stats.duplicates).toBe(1);
  });

  it("rejects garbage without disturbing other clients", async () => {
    const server = await serve();
    const alice = peer(server, "alice");
    const bob = peer(server, "bob");
    await converged(alice, bob);

    const raw = await rawSocket(server);
    raw.send(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    await until(raw.closed, "garbage connection closed");
    expect(raw.received[0]).toMatchObject({ type: "error", fatal: true });

    alice.edit((d) => d.createShapes([{ id: "still-works", props: rect() }]));
    await converged(alice, bob);
    expect(bob.doc.shape("still-works")).toBeDefined();
  });

  it("rejects ops forged under another replica's id", async () => {
    const server = await serve();
    const raw = await rawSocket(server);
    const mallory = new CanvasDocument("mallory");
    raw.send(encodeClientMessage({ type: "hello", version: PROTOCOL_VERSION, docId: "doc", clientId: "eve", since: 0, token: "" }));
    raw.send(encodeClientMessage({ type: "push", clientSeq: 1, delta: encodeDelta(mallory.createShapes([{ id: "x", props: rect() }])) }));
    await until(raw.closed, "forger disconnected");
    expect(raw.received.at(-1)).toMatchObject({ type: "error", message: "delta contains ops from another replica" });
  });

  it("rejects timestamps far in the future (a broken clock can't poison everyone's HLC)", async () => {
    const server = await serve();
    const raw = await rawSocket(server);
    const skewed = new CanvasDocument("eve", () => Date.now() + 60 * 60 * 1000); // 1 hour ahead
    raw.send(encodeClientMessage({ type: "hello", version: PROTOCOL_VERSION, docId: "doc", clientId: "eve", since: 0, token: "" }));
    raw.send(encodeClientMessage({ type: "push", clientSeq: 1, delta: encodeDelta(skewed.createShapes([{ id: "x", props: rect() }])) }));
    await until(raw.closed, "skewed client disconnected");
    expect(raw.received.at(-1)).toMatchObject({ type: "error", fatal: true });
  });

  it("keeps documents isolated from each other", async () => {
    const server = await serve();
    const a = peer(server, "alice", "doc-a");
    const b = peer(server, "bob", "doc-b");
    a.edit((d) => d.createShapes([{ id: "only-in-a", props: rect() }]));
    await converged(a);
    await converged(b);
    expect(b.doc.shape("only-in-a")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Convergence under random disconnects
// ---------------------------------------------------------------------------

type Action =
  | { readonly kind: "create"; readonly who: number }
  | { readonly kind: "move"; readonly who: number; readonly pick: number; readonly x: number }
  | { readonly kind: "delete"; readonly who: number; readonly pick: number }
  | { readonly kind: "toggle"; readonly who: number }
  | { readonly kind: "pause" };

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  { arbitrary: fc.record({ kind: fc.constant("create" as const), who: fc.nat({ max: 2 }) }), weight: 3 },
  { arbitrary: fc.record({ kind: fc.constant("move" as const), who: fc.nat({ max: 2 }), pick: fc.nat(), x: fc.integer({ min: -500, max: 500 }) }), weight: 4 },
  { arbitrary: fc.record({ kind: fc.constant("delete" as const), who: fc.nat({ max: 2 }), pick: fc.nat() }), weight: 1 },
  { arbitrary: fc.record({ kind: fc.constant("toggle" as const), who: fc.nat({ max: 2 }) }), weight: 2 },
  { arbitrary: fc.constant({ kind: "pause" as const }), weight: 1 },
);

describe("sync convergence", () => {
  it("3 clients with random edits and random disconnects all end identical", async () => {
    let shapeCounter = 0;
    await fc.assert(
      fc.asyncProperty(fc.array(actionArb, { minLength: 5, maxLength: 30 }), async (actions) => {
        const server = await serve();
        const peers = ["p0", "p1", "p2"].map((name) => peer(server, name));
        try {
          for (const action of actions) {
            if (action.kind === "pause") {
              await new Promise((resolve) => setTimeout(resolve, 3));
              continue;
            }
            const p = peers[action.who];
            if (!p) continue;
            if (action.kind === "toggle") {
              if (p.client.status === "offline") p.client.start();
              else p.client.stop();
              continue;
            }
            const ids = p.doc.shapes().map((s) => s.id);
            if (action.kind === "create") {
              p.edit((d) => d.createShapes([{ id: `s${shapeCounter++}`, props: rect() }]));
            } else {
              const target = ids[action.pick % Math.max(1, ids.length)];
              if (target === undefined) continue;
              if (action.kind === "move") p.edit((d) => d.updateShapes([{ id: target, patch: { x: action.x } }]));
              else p.edit((d) => d.deleteShapes([target]));
            }
          }
          for (const p of peers) p.client.start();
          await converged(...peers);
        } finally {
          for (const p of peers) p.client.stop();
          await server.close();
          servers.splice(servers.indexOf(server), 1);
        }
      }),
      { numRuns: 40 },
    );
  });
});
