import { afterEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { CanvasDocument, type DocDelta, type ShapeProps } from "@canvas/doc";
import { SyncClient, decodeDelta, type Presence } from "@canvas/sync";
import { MemoryBusHub } from "../src/bus.js";
import { startSyncServer, type SyncServer } from "../src/server.js";
import { MemoryStore } from "../src/store.js";

/**
 * M8: several server instances behind one store, connected by a bus that delivers late
 * and OUT OF ORDER (random delays). Clients are spread across instances. Whatever the
 * interleaving, every client must end with exactly the store's full log applied.
 */
const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function cluster(instances: number, maxBusDelayMs: number, dropRate = 0) {
  const store = new MemoryStore();
  const hub = new MemoryBusHub(maxBusDelayMs, dropRate);
  const servers: SyncServer[] = [];
  for (let i = 0; i < instances; i++) {
    const server = await startSyncServer({ store, bus: hub.connect(`i${i}`), host: "127.0.0.1", snapshotEvery: 40 });
    servers.push(server);
    cleanup.push(() => server.close());
  }
  return { store, servers };
}

function peer(server: SyncServer, name: string, docId = "doc", onPresence?: (id: string, p: Uint8Array | null) => void) {
  const doc = new CanvasDocument(name);
  const client = new SyncClient({
    url: `ws://127.0.0.1:${server.port}`,
    docId,
    clientId: name,
    onDelta: (delta) => doc.merge(delta),
    minBackoffMs: 10,
    maxBackoffMs: 40,
    ...(onPresence ? { onPresence } : {}),
  });
  cleanup.push(() => client.stop());
  client.start();
  return { doc, client, edit: (make: (d: CanvasDocument) => DocDelta) => client.push(make(doc)) };
}

type Peer = ReturnType<typeof peer>;

async function until(condition: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** The document as the store's complete log says it is: the ground truth. */
async function truth(store: MemoryStore, docId = "doc"): Promise<{ head: number; shapes: string }> {
  const doc = new CanvasDocument("truth");
  const log = await store.readSince(docId, 0);
  for (const entry of log) doc.merge(decodeDelta(entry.delta));
  return { head: log.length, shapes: JSON.stringify(doc.shapes()) };
}

async function expectAllMatchTruth(store: MemoryStore, peers: Peer[]): Promise<void> {
  await until(() => peers.every((p) => p.client.status === "online" && p.client.pending === 0), "all flushed");
  const expected = await truth(store);
  await until(() => peers.every((p) => p.client.cursor === expected.head), `every cursor at head ${expected.head}`);
  for (const p of peers) expect(JSON.stringify(p.doc.shapes())).toBe(expected.shapes);
}

const rect = (x = 0): ShapeProps => ({ kind: "rect", x, y: 0, w: 10, h: 10, fill: 0x137d77 });

describe("multiple server instances", () => {
  it("edits made through one instance reach clients on another", async () => {
    const { store, servers } = await cluster(2, 0);
    const [a, b] = servers;
    if (!a || !b) throw new Error("cluster");
    const alice = peer(a, "alice");
    const bob = peer(b, "bob");
    await until(() => alice.client.status === "online" && bob.client.status === "online", "online");
    alice.edit((d) => d.createShapes([{ id: "from-alice", props: rect() }]));
    bob.edit((d) => d.createShapes([{ id: "from-bob", props: rect(5) }]));
    await expectAllMatchTruth(store, [alice, bob]);
    expect(bob.doc.shape("from-alice")).toBeDefined();
    expect(alice.doc.shape("from-bob")).toBeDefined();
  });

  it("GATE: 3 instances, reordering bus, random edits and disconnects — nobody misses a delta", async () => {
    let totalOutOfOrder = 0;
    let created = 0;
    type Action =
      | { kind: "create"; who: number }
      | { kind: "move"; who: number; pick: number; x: number }
      | { kind: "toggle"; who: number }
      | { kind: "pause" };
    const actionArb: fc.Arbitrary<Action> = fc.oneof(
      { arbitrary: fc.record({ kind: fc.constant("create" as const), who: fc.nat({ max: 5 }) }), weight: 2 },
      { arbitrary: fc.record({ kind: fc.constant("move" as const), who: fc.nat({ max: 5 }), pick: fc.nat(), x: fc.integer({ min: 0, max: 999 }) }), weight: 6 },
      { arbitrary: fc.record({ kind: fc.constant("toggle" as const), who: fc.nat({ max: 5 }) }), weight: 1 },
      { arbitrary: fc.constant({ kind: "pause" as const }), weight: 1 },
    );

    await fc.assert(
      fc.asyncProperty(fc.array(actionArb, { minLength: 20, maxLength: 60 }), async (actions) => {
        const { store, servers } = await cluster(3, 25);
        // 6 clients, two per instance.
        const peers = ["p0", "p1", "p2", "p3", "p4", "p5"].map((name, i) => {
          const server = servers[i % servers.length];
          if (!server) throw new Error("cluster");
          return peer(server, name);
        });
        await until(() => peers.every((p) => p.client.status === "online"), "online");
        try {
          for (const action of actions) {
            if (action.kind === "pause") {
              await new Promise((resolve) => setTimeout(resolve, 10));
              continue;
            }
            const p = peers[action.who];
            if (!p) continue;
            if (action.kind === "toggle") {
              if (p.client.status === "offline") p.client.start();
              else p.client.stop();
            } else if (action.kind === "create") {
              p.edit((d) => d.createShapes([{ id: `s${created++}`, props: rect() }]));
            } else {
              const ids = p.doc.shapes().map((s) => s.id);
              const target = ids[action.pick % Math.max(1, ids.length)];
              if (target) p.edit((d) => d.updateShapes([{ id: target, patch: { x: action.x } }]));
            }
          }
          for (const p of peers) p.client.start();
          await expectAllMatchTruth(store, peers);
          totalOutOfOrder += servers.reduce((n, s) => n + s.ordering().outOfOrder, 0);
        } finally {
          for (const p of peers) p.client.stop();
          for (const server of servers) await server.close();
        }
      }),
      { numRuns: 25 },
    );
    // Proof the test exercised what it claims: deltas really did arrive out of order.
    expect(totalOutOfOrder).toBeGreaterThan(0);
  });

  it("recovers deltas the bus LOST, including the very last one", async () => {
    const { store, servers } = await cluster(2, 5, 0.5); // half of all bus messages vanish
    const [a, b] = servers;
    if (!a || !b) throw new Error("cluster");
    const alice = peer(a, "alice");
    const bob = peer(b, "bob");
    await until(() => alice.client.status === "online" && bob.client.status === "online", "online");
    alice.edit((d) => d.createShapes([{ id: "s", props: rect() }]));
    for (let i = 1; i <= 20; i++) alice.edit((d) => d.updateShapes([{ id: "s", patch: { x: i } }]));
    // The last delta may well be one of the lost ones: only the tail check can save it.
    await expectAllMatchTruth(store, [alice, bob]);
    expect(bob.doc.shape("s")?.x).toBe(20);
    expect(b.ordering().gapFills).toBeGreaterThan(0);
  });

  it("presence crosses instances, including for someone who joins later on another instance", async () => {
    const { servers } = await cluster(2, 10);
    const [a, b] = servers;
    if (!a || !b) throw new Error("cluster");
    const seenByBob = new Map<string, Uint8Array>();
    const seenByCarol = new Map<string, Uint8Array>();
    const alice = peer(a, "alice");
    peer(b, "bob", "doc", (id, payload) => (payload ? seenByBob.set(id, payload) : seenByBob.delete(id)));
    await until(() => alice.client.status === "online", "online");
    const presence: Presence = { name: "Alice", color: 0xdd4f78, cursor: { x: 1, y: 2 }, selection: [] };
    const { encodePresence } = await import("@canvas/sync");
    alice.client.setPresence(encodePresence(presence));
    await until(() => seenByBob.has("alice"), "bob (other instance) sees alice");

    peer(b, "carol", "doc", (id, payload) => (payload ? seenByCarol.set(id, payload) : seenByCarol.delete(id)));
    await until(() => seenByCarol.has("alice"), "late joiner on the other instance sees alice");

    alice.client.stop();
    await until(() => !seenByBob.has("alice") && !seenByCarol.has("alice"), "leave crosses instances");
  });
});
