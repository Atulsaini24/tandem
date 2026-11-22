import { afterAll, describe, expect, it } from "vitest";
import { PostgresStore } from "../src/postgres-store.js";
import { MemoryStore, type Store } from "../src/store.js";

/**
 * One contract, every Store. The in-memory store that the other tests use must behave
 * exactly like the Postgres store that production uses — otherwise those tests prove
 * nothing about production.
 *
 * Postgres runs when DATABASE_URL is set (see docker-compose.yml); otherwise it's skipped.
 */
const databaseUrl = process.env.DATABASE_URL;
const opened: Store[] = [];

afterAll(async () => {
  for (const store of opened) await store.close();
});

interface Backend {
  readonly name: string;
  readonly enabled: boolean;
  open(): Promise<Store>;
  /** A second handle on the same data (a new connection / a "restarted server"). */
  reopen(first: Store): Promise<Store>;
}

const backends: Backend[] = [
  {
    name: "MemoryStore",
    enabled: true,
    open: async () => new MemoryStore(),
    reopen: async (first) => first,
  },
  {
    name: "PostgresStore",
    enabled: databaseUrl !== undefined,
    open: async () => {
      const store = await PostgresStore.connect(databaseUrl ?? "");
      opened.push(store);
      return store;
    },
    reopen: async () => {
      const store = await PostgresStore.connect(databaseUrl ?? "");
      opened.push(store);
      return store;
    },
  },
];

/** Unique per run, so tests never see each other's rows in a shared database. */
const docId = (label: string): string => `${label}-${crypto.randomUUID().slice(0, 8)}`;
const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

for (const backend of backends) {
  describe.skipIf(!backend.enabled)(`${backend.name} contract`, () => {
    it("numbers appends 1, 2, 3 per document, independently per document", async () => {
      const store = await backend.open();
      const a = docId("a");
      const b = docId("b");
      expect(await store.append(a, "c1", 1, bytes(1))).toBe(1);
      expect(await store.append(a, "c1", 2, bytes(2))).toBe(2);
      expect(await store.append(b, "c1", 1, bytes(9))).toBe(1);
      expect(await store.append(a, "c2", 1, bytes(3))).toBe(3);
      expect(await store.head(a)).toBe(3);
      expect(await store.head(b)).toBe(1);
      expect(await store.head(docId("empty"))).toBe(0);
    });

    it("stores a (clientId, clientSeq) once and reports the resend as a duplicate", async () => {
      const store = await backend.open();
      const doc = docId("dup");
      expect(await store.append(doc, "c1", 1, bytes(1))).toBe(1);
      expect(await store.append(doc, "c1", 1, bytes(1))).toBe("duplicate");
      expect(await store.append(doc, "c2", 1, bytes(2))).toBe(2); // same clientSeq, other client: fine
      expect(await store.head(doc)).toBe(2);
    });

    it("reads exactly the tail after a cursor, bytes intact, in order", async () => {
      const store = await backend.open();
      const doc = docId("tail");
      const payloads = [bytes(0), bytes(1, 2, 3), bytes(255, 0, 128), new Uint8Array(70_000).fill(7)];
      for (const [i, payload] of payloads.entries()) await store.append(doc, "c", i + 1, payload);

      const tail = await store.readSince(doc, 2);
      expect(tail.map((e) => e.seq)).toEqual([3, 4]);
      expect(tail[0]?.delta).toEqual(payloads[2]);
      expect(tail[1]?.delta).toEqual(payloads[3]);
      expect(await store.readSince(doc, 4)).toEqual([]);
      expect((await store.readSince(doc, 0)).length).toBe(4);
    });

    it("keeps the log and the dedupe record across a reconnect", async () => {
      const first = await backend.open();
      const doc = docId("restart");
      await first.append(doc, "c", 1, bytes(42));
      const second = await backend.reopen(first);
      expect(await second.head(doc)).toBe(1);
      expect((await second.readSince(doc, 0))[0]?.delta).toEqual(bytes(42));
      expect(await second.append(doc, "c", 1, bytes(42))).toBe("duplicate");
    });
  });
}
