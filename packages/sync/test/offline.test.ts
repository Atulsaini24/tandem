import { describe, expect, it } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import type { ShapeProps } from "@canvas/doc";
import { LocalStore, OfflineReplica } from "../src/offline.js";

/**
 * Persistence without a network: every replica here stays offline (never start()ed),
 * which is exactly the "refresh while offline" scenario.
 */

const rect = (x = 0): ShapeProps => ({ kind: "rect", x, y: 0, w: 10, h: 10, fill: 0x2f63ff });

/** One "browser profile": an IndexedDB factory that survives "reloads". */
function profile() {
  const factory = new IDBFactory();
  return { open: () => LocalStore.open({ factory, keyRange: IDBKeyRange }) };
}

/** Web Locks stand-in: a lease is held until release(). */
function lockRegistry() {
  const held = new Set<string>();
  return {
    claim: async (key: string) => {
      if (held.has(key)) return false;
      held.add(key);
      return true;
    },
    releaseAll: () => held.clear(), // "all tabs closed"
  };
}

async function openReplica(storage: LocalStore, locks: ReturnType<typeof lockRegistry>, compactEvery?: number) {
  return OfflineReplica.open({
    url: "ws://unused",
    docId: "doc",
    storage,
    claim: locks.claim,
    ...(compactEvery === undefined ? {} : { compactEvery }),
  });
}

describe("OfflineReplica persistence", () => {
  it("GATE: offline edits survive a reload — document, outbox and replica id", async () => {
    const browser = profile();
    const locks = lockRegistry();

    const before = await openReplica(await browser.open(), locks);
    before.commit(before.doc.createShapes([{ id: "s1", props: rect() }, { id: "s2", props: rect(20) }]));
    before.commit(before.doc.updateShapes([{ id: "s1", patch: { x: 99 } }]));
    before.commit(before.doc.deleteShapes(["s2"]));
    await before.flush();
    const shapesBefore = before.doc.shapes();

    locks.releaseAll(); // the tab is gone (reload)
    const after = await openReplica(await browser.open(), locks);

    expect(after.restored).toMatchObject({ resumed: true, seeded: false, pending: 3 });
    expect(after.replicaId).toBe(before.replicaId);
    expect(after.doc.shapes()).toEqual(shapesBefore);
    expect(after.sync.pending).toBe(3); // will be sent on reconnect
  });

  it("continues clientSeq and HLC after a reload (no collisions with the old session)", async () => {
    const browser = profile();
    const locks = lockRegistry();
    const first = await openReplica(await browser.open(), locks);
    first.commit(first.doc.createShapes([{ id: "s1", props: rect() }]));
    await first.flush();
    locks.releaseAll();

    const second = await openReplica(await browser.open(), locks);
    second.commit(second.doc.updateShapes([{ id: "s1", patch: { x: 5 } }]));
    await second.flush();
    locks.releaseAll();

    const third = await openReplica(await browser.open(), locks);
    expect(third.sync.pending).toBe(2);
    expect(third.doc.shape("s1")?.x).toBe(5); // the newer write wins: its HLC is later
  });

  it("two tabs at once never share a replica id; the second is seeded with the state", async () => {
    const browser = profile();
    const locks = lockRegistry();
    const tabA = await openReplica(await browser.open(), locks);
    tabA.commit(tabA.doc.createShapes([{ id: "from-a", props: rect() }]));
    await tabA.flush();

    const tabB = await openReplica(await browser.open(), locks); // A still holds its lease
    expect(tabB.replicaId).not.toBe(tabA.replicaId);
    expect(tabB.restored).toMatchObject({ resumed: false, seeded: true, pending: 0 });
    expect(tabB.doc.shape("from-a")).toBeDefined(); // sees A's state immediately
    expect(tabB.sync.pending).toBe(0); // but A's unsent edits stay A's to send
  });

  it("compacts the log into a snapshot and restores identically", async () => {
    const browser = profile();
    const locks = lockRegistry();
    const store = await browser.open();
    const replica = await openReplica(store, locks, 10);
    replica.commit(replica.doc.createShapes(Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, props: rect(i) }))));
    for (let i = 0; i < 25; i++) replica.commit(replica.doc.updateShapes([{ id: `s${i % 5}`, patch: { x: i * 10 } }]));
    await replica.flush();
    expect(store.logCount("doc", replica.replicaId)).toBeLessThan(10);

    locks.releaseAll();
    const restored = await openReplica(await browser.open(), locks, 10);
    expect(restored.doc.shapes()).toEqual(replica.doc.shapes());
    expect(restored.restored.entries).toBeLessThan(12); // snapshot + short tail, not 26 entries
  });

  it("a brand-new profile starts empty with a fresh replica", async () => {
    const replica = await openReplica(await profile().open(), lockRegistry());
    expect(replica.restored).toEqual({ resumed: false, seeded: false, entries: 0, pending: 0 });
    expect(replica.doc.shapes()).toEqual([]);
  });
});
