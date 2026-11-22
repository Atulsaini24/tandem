import { afterEach, describe, expect, it } from "vitest";
import { CanvasDocument, type DocDelta, type ShapeProps } from "@canvas/doc";
import { SyncClient } from "@canvas/sync";
import { startSyncServer, type SyncServer } from "../src/server.js";
import { MemoryStore } from "../src/store.js";

/**
 * M7 server side: snapshots (fast joins) and history (time travel).
 * Small snapshotEvery values keep the tests quick; the logic doesn't depend on size.
 */
const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function serve(store = new MemoryStore(), snapshotEvery = 50): Promise<SyncServer> {
  const server = await startSyncServer({ store, host: "127.0.0.1", snapshotEvery, snapshotMinGap: 10 });
  cleanup.push(() => server.close());
  return server;
}

function peer(server: SyncServer, name: string, docId = "doc") {
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
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const rect = (x = 0): ShapeProps => ({ kind: "rect", x, y: 0, w: 10, h: 10, fill: 0x7b55e7 });

describe("snapshots", () => {
  it("a new client joins with one snapshot + the tail instead of the whole log", async () => {
    const server = await serve(new MemoryStore(), 50);
    const writer = peer(server, "writer");
    writer.edit((d) => d.createShapes([{ id: "s", props: rect() }]));
    for (let i = 1; i < 130; i++) writer.edit((d) => d.updateShapes([{ id: "s", patch: { x: i } }]));
    await until(() => writer.client.pending === 0 && writer.client.cursor === 130, "writer flushed");
    expect(server.stats.snapshotsWritten).toBe(2); // at 50 and 100

    const joiner = peer(server, "joiner");
    await until(() => joiner.client.status === "online", "joiner online");
    // snapshot@100 + deltas 101..130 = 31 messages, not 130
    expect(joiner.client.stats.deltasReceived).toBe(31);
    expect(server.stats.snapshotsSent).toBe(1);
    expect(joiner.client.cursor).toBe(130);
    expect(joiner.doc.shapes()).toEqual(writer.doc.shapes());
  });

  it("a client only slightly behind gets plain deltas, not a snapshot", async () => {
    const server = await serve(new MemoryStore(), 50);
    const writer = peer(server, "writer");
    const reader = peer(server, "reader");
    // Both must be live before writing: a reader that joins after the snapshot exists
    // (from seq 0) is correctly served that snapshot, which isn't what this test is about.
    await until(() => writer.client.status === "online" && reader.client.status === "online", "both online");
    writer.edit((d) => d.createShapes([{ id: "s", props: rect() }]));
    for (let i = 1; i < 55; i++) writer.edit((d) => d.updateShapes([{ id: "s", patch: { x: i } }]));
    await until(() => reader.client.cursor === 55, "reader caught up live");
    reader.client.stop();
    for (let i = 0; i < 5; i++) writer.edit((d) => d.updateShapes([{ id: "s", patch: { x: 1000 + i } }]));
    await until(() => writer.client.pending === 0, "writer flushed");

    const before = reader.client.stats.deltasReceived;
    reader.client.start();
    await until(() => reader.client.cursor === 60, "reader reconnected");
    expect(reader.client.stats.deltasReceived - before).toBe(5);
    expect(server.stats.snapshotsSent).toBe(0);
  });
});

describe("history", () => {
  it("returns the document exactly as it was at any past seq", async () => {
    const server = await serve(new MemoryStore(), 50);
    const writer = peer(server, "writer");
    const deltas: DocDelta[] = [];
    deltas.push(writer.doc.createShapes([{ id: "a", props: rect(0) }]));
    for (let i = 1; i < 120; i++) {
      deltas.push(
        i % 17 === 0
          ? writer.doc.createShapes([{ id: `s${i}`, props: rect(i) }])
          : writer.doc.updateShapes([{ id: "a", patch: { x: i } }]),
      );
    }
    for (const delta of deltas) writer.client.push(delta);
    await until(() => writer.client.pending === 0, "flushed");

    for (const at of [0, 1, 17, 49, 50, 51, 99, 100, 101, 120]) {
      const expected = new CanvasDocument("ref");
      for (const delta of deltas.slice(0, at)) expected.merge(delta);
      const version = await writer.client.requestHistory(at);
      const actual = new CanvasDocument("view");
      actual.merge(version.state);
      expect({ at: version.at, shapes: actual.shapes() }).toEqual({ at, shapes: expected.shapes() });
      expect(version.head).toBe(120);
    }
  });

  it("clamps a request past the head to the head", async () => {
    const server = await serve();
    const writer = peer(server, "writer");
    writer.edit((d) => d.createShapes([{ id: "a", props: rect() }]));
    await until(() => writer.client.pending === 0, "flushed");
    const version = await writer.client.requestHistory(9_999);
    expect(version.at).toBe(1);
  });

  it("fails fast instead of hanging when offline", async () => {
    const server = await serve();
    const writer = peer(server, "writer");
    await until(() => writer.client.status === "online", "online");
    writer.client.stop();
    await expect(writer.client.requestHistory(0)).rejects.toThrow("history needs a connection");
  });
});
