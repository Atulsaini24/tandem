import { afterEach, describe, expect, it } from "vitest";
import { CanvasDocument, type ShapeProps } from "@canvas/doc";
import { SyncClient } from "@canvas/sync";
import { PostgresStore } from "../src/postgres-store.js";
import { startSyncServer, type SyncServer } from "../src/server.js";
import type { Store } from "../src/store.js";

/**
 * The M5 gate again, end to end over a real Postgres: browsers' sync clients ↔ server ↔ DB,
 * including a full server + database-connection restart. Runs when DATABASE_URL is set.
 */
const databaseUrl = process.env.DATABASE_URL;
const cleanup: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function serve(): Promise<{ server: SyncServer; store: Store }> {
  const store = await PostgresStore.connect(databaseUrl ?? "");
  const server = await startSyncServer({ store, host: "127.0.0.1" });
  cleanup.push(() => store.close(), () => server.close());
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
  return { doc, client, edit: (make: (d: CanvasDocument) => ReturnType<CanvasDocument["createShapes"]>) => client.push(make(doc)) };
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const rect = (x = 0): ShapeProps => ({ kind: "rect", x, y: 0, w: 10, h: 10, fill: 0x1e8f5a });

describe.skipIf(databaseUrl === undefined)("sync over Postgres", () => {
  it("GATE over Postgres: offline edits sync after reconnect, only missing changes sent", async () => {
    const docId = `e2e-${crypto.randomUUID().slice(0, 8)}`;
    const { server } = await serve();
    const alice = peer(server, "alice", docId);
    const bob = peer(server, "bob", docId);
    alice.edit((d) => d.createShapes([{ id: "s1", props: rect() }, { id: "s2", props: rect() }]));
    await until(() => bob.doc.shape("s2") !== undefined && alice.client.pending === 0, "initial sync");

    bob.client.stop();
    for (let i = 1; i <= 3; i++) alice.edit((d) => d.updateShapes([{ id: "s1", patch: { x: i * 100 } }]));
    bob.edit((d) => d.updateShapes([{ id: "s2", patch: { fill: 0xff0000 } }]));
    bob.edit((d) => d.createShapes([{ id: "s3", props: rect(7) }]));
    await until(() => alice.client.pending === 0, "alice flushed");

    const before = bob.client.stats.deltasReceived;
    bob.client.start();
    await until(
      () => bob.client.pending === 0 && alice.doc.shape("s3") !== undefined && bob.doc.shape("s1")?.x === 300,
      "bob reconciled",
    );
    expect(bob.client.stats.deltasReceived - before).toBe(3);
    expect(JSON.stringify(alice.doc.shapes())).toBe(JSON.stringify(bob.doc.shapes()));
  });

  it("history survives a full server + database-connection restart", async () => {
    const docId = `restart-${crypto.randomUUID().slice(0, 8)}`;
    const first = await serve();
    const alice = peer(first.server, "alice", docId);
    alice.edit((d) => d.createShapes([{ id: "kept", props: rect(5) }]));
    alice.edit((d) => d.updateShapes([{ id: "kept", patch: { x: 99 } }]));
    await until(() => alice.client.pending === 0, "alice durable");
    alice.client.stop();
    await first.server.close();
    await first.store.close();

    const second = await serve(); // new process-equivalent: new pool, new server, same DB
    const carol = peer(second.server, "carol", docId);
    await until(() => carol.doc.shape("kept")?.x === 99, "carol replays history from Postgres");
  });
});
