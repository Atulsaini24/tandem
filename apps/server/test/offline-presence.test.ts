import { afterEach, describe, expect, it } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import type { ShapeProps } from "@canvas/doc";
import type { Presence } from "@canvas/sync";
import { LocalStore, OfflineReplica } from "@canvas/sync/offline";
import { startSyncServer, type SyncServer } from "../src/server.js";
import { MemoryStore } from "../src/store.js";

/**
 * M6 end to end: real server, real WebSockets, IndexedDB-backed replicas (fake-indexeddb
 * in Node). A "browser" is an IndexedDB profile; "reload" = drop the replica and open a
 * new one on the same profile.
 */

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function serve(): Promise<SyncServer> {
  const server = await startSyncServer({ store: new MemoryStore(), host: "127.0.0.1" });
  cleanup.push(() => server.close());
  return server;
}

function browserProfile() {
  const factory = new IDBFactory();
  const held = new Set<string>();
  return {
    claim: async (key: string) => (held.has(key) ? false : (held.add(key), true)),
    closeAllTabs: () => held.clear(),
    storage: () => LocalStore.open({ factory, keyRange: IDBKeyRange }),
  };
}

type Profile = ReturnType<typeof browserProfile>;

async function tab(server: SyncServer, profile: Profile, presences?: Map<string, Presence>) {
  const replica = await OfflineReplica.open({
    url: `ws://127.0.0.1:${server.port}`,
    docId: "doc",
    storage: await profile.storage(),
    claim: profile.claim,
    minBackoffMs: 10,
    maxBackoffMs: 50,
    ...(presences
      ? { onPresence: (id: string, p: Presence | null) => (p ? presences.set(id, p) : presences.delete(id)) }
      : {}),
  });
  cleanup.push(() => replica.close());
  return replica;
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const rect = (x = 0): ShapeProps => ({ kind: "rect", x, y: 0, w: 10, h: 10, fill: 0xef6b3a });
const me = (name: string, x: number, selection: string[] = []): Presence => ({ name, color: 0x2f63ff, cursor: { x, y: 1 }, selection });

describe("M6 gate: refresh while offline", () => {
  it("edits made offline survive a reload and sync once back online — only those edits", async () => {
    const server = await serve();
    const aliceBrowser = browserProfile();
    const bob = await tab(server, browserProfile());
    bob.start();

    let alice = await tab(server, aliceBrowser);
    alice.start();
    alice.commit(alice.doc.createShapes([{ id: "s1", props: rect() }]));
    await until(() => bob.doc.shape("s1") !== undefined && alice.sync.pending === 0, "initial sync");

    // Alice goes offline, edits, and reloads the page while still offline.
    alice.stop();
    alice.commit(alice.doc.updateShapes([{ id: "s1", patch: { x: 500 } }]));
    alice.commit(alice.doc.createShapes([{ id: "offline-shape", props: rect(9) }]));
    bob.commit(bob.doc.createShapes([{ id: "from-bob", props: rect(3) }])); // meanwhile, Bob edits
    await alice.close();
    aliceBrowser.closeAllTabs();

    alice = await tab(server, aliceBrowser); // the reload
    expect(alice.restored).toMatchObject({ resumed: true, pending: 2 });
    expect(alice.doc.shape("s1")?.x).toBe(500); // offline edit is still there before reconnecting
    expect(alice.doc.shape("offline-shape")).toBeDefined();

    const sentBefore = alice.sync.stats.deltasSent;
    alice.start(); // back online
    await until(
      () => alice.sync.pending === 0 && bob.doc.shape("offline-shape") !== undefined && alice.doc.shape("from-bob") !== undefined,
      "reconciled after reload",
    );
    expect(alice.sync.stats.deltasSent - sentBefore).toBe(2); // exactly the 2 offline edits
    expect(alice.sync.stats.deltasReceived).toBe(1); // exactly Bob's 1 edit (cursor survived the reload)
    expect(JSON.stringify(alice.doc.shapes())).toBe(JSON.stringify(bob.doc.shapes()));
  });

  it("a reload with the cursor restored doesn't re-download history", async () => {
    const server = await serve();
    const profile = browserProfile();
    let replica = await tab(server, profile);
    replica.start();
    for (let i = 0; i < 10; i++) replica.commit(replica.doc.createShapes([{ id: `s${i}`, props: rect(i) }]));
    await until(() => replica.sync.pending === 0, "flushed");
    await replica.close();
    profile.closeAllTabs();

    replica = await tab(server, profile);
    replica.start();
    await until(() => replica.sync.status === "online", "reconnected");
    expect(replica.sync.stats.deltasReceived).toBe(0);
    expect(replica.doc.shapes()).toHaveLength(10);
  });
});

describe("M6 gate: live presence", () => {
  it("relays cursors and selections, replays them to late joiners, and removes them on leave", async () => {
    const server = await serve();
    const seenByBob = new Map<string, Presence>();
    const seenByCarol = new Map<string, Presence>();

    const alice = await tab(server, browserProfile());
    alice.start();
    alice.setPresence(me("Alice", 10, ["s1"]));

    const bob = await tab(server, browserProfile(), seenByBob);
    bob.start();
    await until(() => seenByBob.get(alice.replicaId)?.cursor?.x === 10, "bob sees alice (replayed on join)");
    expect(seenByBob.get(alice.replicaId)?.selection).toEqual(["s1"]);

    alice.setPresence(me("Alice", 250));
    await until(() => seenByBob.get(alice.replicaId)?.cursor?.x === 250, "bob sees alice move");

    const carol = await tab(server, browserProfile(), seenByCarol);
    carol.start();
    await until(() => seenByCarol.has(alice.replicaId), "late joiner gets current presence");

    alice.stop(); // closes her connection
    await until(() => !seenByBob.has(alice.replicaId) && !seenByCarol.has(alice.replicaId), "leave removes her cursor");
  });

  it("presence survives the sender reconnecting", async () => {
    const server = await serve();
    const seen = new Map<string, Presence>();
    const alice = await tab(server, browserProfile());
    alice.start();
    alice.setPresence(me("Alice", 42));
    const bob = await tab(server, browserProfile(), seen);
    bob.start();
    await until(() => seen.has(alice.replicaId), "seen");

    alice.stop();
    await until(() => !seen.has(alice.replicaId), "left");
    alice.start(); // the client re-sends its last presence after reconnecting
    await until(() => seen.get(alice.replicaId)?.cursor?.x === 42, "back with the same cursor");
  });
});
