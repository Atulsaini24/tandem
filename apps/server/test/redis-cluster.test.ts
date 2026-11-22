import { afterEach, describe, expect, it } from "vitest";
import { CanvasDocument, type DocDelta, type ShapeProps } from "@canvas/doc";
import { SyncClient, decodeDelta } from "@canvas/sync";
import { RedisBus } from "../src/bus.js";
import { PostgresStore } from "../src/postgres-store.js";
import { startSyncServer, type SyncServer } from "../src/server.js";

/**
 * The real thing: two server instances, each with its own Postgres pool and Redis
 * connections, as two processes behind a load balancer would be. Runs when both
 * DATABASE_URL and REDIS_URL are set (`pnpm db:up`; CI provides both).
 */
const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function instance(name: string): Promise<{ server: SyncServer; store: PostgresStore }> {
  const store = await PostgresStore.connect(databaseUrl ?? "");
  const bus = await RedisBus.connect(redisUrl ?? "", name);
  const server = await startSyncServer({ store, bus, host: "127.0.0.1" });
  cleanup.push(() => store.close(), () => bus.close(), () => server.close());
  return { server, store };
}

function peer(server: SyncServer, name: string, docId: string) {
  const doc = new CanvasDocument(name);
  const client = new SyncClient({
    url: `ws://127.0.0.1:${server.port}`,
    docId,
    clientId: name,
    onDelta: (delta) => doc.merge(delta),
    minBackoffMs: 10,
    maxBackoffMs: 50,
  });
  cleanup.push(() => client.stop());
  client.start();
  return { doc, client, edit: (make: (d: CanvasDocument) => DocDelta) => client.push(make(doc)) };
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const rect = (x = 0): ShapeProps => ({ kind: "rect", x, y: 0, w: 10, h: 10, fill: 0x2f63ff });

describe.skipIf(!databaseUrl || !redisUrl)("two instances over real Redis + Postgres", () => {
  it("concurrent writers on both instances: gapless seqs, no conflicts, everyone converges", async () => {
    const docId = `cluster-${crypto.randomUUID().slice(0, 8)}`;
    const a = await instance("inst-a");
    const b = await instance("inst-b");
    const peers = [
      peer(a.server, "p0", docId),
      peer(b.server, "p1", docId),
      peer(a.server, "p2", docId),
      peer(b.server, "p3", docId),
    ];
    await until(() => peers.every((p) => p.client.status === "online"), "online");
    peers[0]?.edit((d) => d.createShapes(Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, props: rect(i) }))));
    await until(() => peers.every((p) => p.doc.shapes().length === 4), "shapes everywhere");

    // Everyone writes at once, through both instances: the per-doc advisory lock must
    // serialize seq assignment across processes.
    for (let round = 0; round < 50; round++) {
      peers.forEach((p, i) => p.edit((d) => d.updateShapes([{ id: `s${i}`, patch: { x: round } }])));
    }
    await until(() => peers.every((p) => p.client.pending === 0), "all acked");

    const log = await a.store.readSince(docId, 0);
    expect(log.map((e) => e.seq)).toEqual(Array.from({ length: log.length }, (_, i) => i + 1)); // gapless 1..N
    expect(log.length).toBe(1 + 4 * 50);

    const truth = new CanvasDocument("truth");
    for (const entry of log) truth.merge(decodeDelta(entry.delta));
    await until(() => peers.every((p) => p.client.cursor === log.length), "every client at head");
    for (const p of peers) expect(p.doc.shapes()).toEqual(truth.shapes());
    expect(a.server.stats.fromBus + b.server.stats.fromBus).toBeGreaterThan(0); // really crossed Redis
  });
});
