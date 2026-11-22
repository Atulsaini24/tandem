import { afterEach, describe, expect, it } from "vitest";
import { CanvasDocument, type ShapeProps } from "@canvas/doc";
import { SyncClient, type SyncState } from "@canvas/sync";
import { signToken, verifyToken, type TokenClaims } from "../src/auth.js";
import { TokenBucket } from "../src/rate-limit.js";
import { startSyncServer, type RateLimits, type SyncServer } from "../src/server.js";
import { MemoryStore } from "../src/store.js";

const SECRET = "test-secret-not-for-production";
const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function serve(options: { authSecret?: string; limits?: RateLimits } = {}): Promise<SyncServer> {
  const server = await startSyncServer({ store: new MemoryStore(), host: "127.0.0.1", ...options });
  cleanup.push(() => server.close());
  return server;
}

function client(server: SyncServer, name: string, token?: string) {
  const doc = new CanvasDocument(name);
  const states: SyncState[] = [];
  const sync = new SyncClient({
    url: `ws://127.0.0.1:${server.port}`,
    docId: "doc",
    clientId: name,
    onDelta: (delta) => doc.merge(delta),
    onState: (state) => states.push(state),
    minBackoffMs: 10,
    maxBackoffMs: 30,
    ...(token === undefined ? {} : { token }),
  });
  cleanup.push(() => sync.stop());
  sync.start();
  return { doc, sync, lastError: () => states.at(-1)?.error };
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const rect = (x = 0): ShapeProps => ({ kind: "rect", x, y: 0, w: 10, h: 10, fill: 0xc6513c });
const hour = (): number => Math.floor(Date.now() / 1000) + 3600;
const token = (claims: Partial<TokenClaims> = {}): string =>
  signToken(SECRET, { doc: "doc", sub: "user-1", role: "editor", exp: hour(), ...claims });

describe("tokens", () => {
  it("verifies signature, expiry and document", () => {
    const now = Date.now();
    expect(verifyToken(SECRET, token(), "doc", now)).toMatchObject({ sub: "user-1", role: "editor" });
    expect(verifyToken(SECRET, token({ doc: "*" }), "any-doc", now)).toMatchObject({ doc: "*" });
    expect(verifyToken(SECRET, token(), "other-doc", now)).toBe("token is for another document");
    expect(verifyToken(SECRET, token({ exp: Math.floor(now / 1000) - 1 }), "doc", now)).toBe("token expired");
    expect(verifyToken("wrong-secret", token(), "doc", now)).toBe("bad token signature");
    // Tampering with the claims (e.g. upgrading viewer → editor) breaks the signature.
    const [, signature] = token({ role: "viewer" }).split(".");
    const forged = `${Buffer.from(JSON.stringify({ doc: "doc", sub: "x", role: "editor", exp: hour() })).toString("base64url")}.${signature}`;
    expect(verifyToken(SECRET, forged, "doc", now)).toBe("bad token signature");
    expect(verifyToken(SECRET, "garbage", "doc", now)).toBe("malformed token");
  });
});

describe("server with auth", () => {
  it("rejects a connection without a valid token", async () => {
    const server = await serve({ authSecret: SECRET });
    const anonymous = client(server, "anon");
    await until(() => anonymous.lastError() !== undefined, "rejected");
    expect(anonymous.lastError()).toBe("unauthorized: malformed token");
    expect(anonymous.sync.status).toBe("offline"); // fatal: stops retrying
    expect(server.stats.unauthorized).toBe(1);
  });

  it("an editor can edit; a viewer can watch but not edit", async () => {
    const server = await serve({ authSecret: SECRET });
    const editor = client(server, "editor", token());
    const viewer = client(server, "viewer", token({ role: "viewer", sub: "user-2" }));
    await until(() => editor.sync.status === "online" && viewer.sync.status === "online", "both online");

    editor.sync.push(editor.doc.createShapes([{ id: "s", props: rect() }]));
    await until(() => viewer.doc.shape("s") !== undefined, "viewer receives edits");

    viewer.sync.push(viewer.doc.updateShapes([{ id: "s", patch: { x: 500 } }]));
    await until(() => viewer.lastError() !== undefined, "viewer edit rejected");
    expect(viewer.lastError()).toBe("read-only access: this token can't edit");
    expect(editor.doc.shape("s")?.x).toBe(0);
  });
});

describe("rate limits", () => {
  it("token bucket allows a burst, then refills at the rate", () => {
    let now = 0;
    const bucket = new TokenBucket(10, 5, () => now);
    for (let i = 0; i < 5; i++) expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
    now = 100; // 0.1s at 10/s = 1 token
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
  });

  it("a client over the limit is slowed down, but nothing is lost", async () => {
    const server = await serve({ limits: { pushesPerSec: 50, pushBurst: 20, presencePerSec: 60, historyPerSec: 20 } });
    const flooder = client(server, "flooder");
    const watcher = client(server, "watcher");
    await until(() => flooder.sync.status === "online" && watcher.sync.status === "online", "online");
    flooder.sync.push(flooder.doc.createShapes([{ id: "s", props: rect() }]));
    for (let i = 1; i <= 120; i++) flooder.sync.push(flooder.doc.updateShapes([{ id: "s", patch: { x: i } }]));

    await until(() => flooder.sync.pending === 0 && watcher.doc.shape("s")?.x === 120, "everything arrives eventually");
    expect(server.stats.rateLimited).toBeGreaterThan(0); // it really was throttled
    expect(flooder.sync.stats.connects).toBe(1); // by backpressure, not by disconnecting it
  });

  it("a client that ignores flow control and floods is disconnected", async () => {
    const server = await serve({ limits: { pushesPerSec: 10, pushBurst: 10, presencePerSec: 60, historyPerSec: 20 } });
    const { PROTOCOL_VERSION, encodeClientMessage, encodeDelta } = await import("@canvas/sync");
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    let closeCode = 0;
    socket.onclose = (event) => (closeCode = event.code);
    await new Promise((resolve) => (socket.onopen = resolve));
    const doc = new CanvasDocument("flood");
    socket.send(encodeClientMessage({ type: "hello", version: PROTOCOL_VERSION, docId: "doc", clientId: "flood", since: 0, token: "" }));
    doc.createShapes([{ id: "s", props: rect() }]);
    for (let i = 1; i <= 500; i++) {
      socket.send(encodeClientMessage({ type: "push", clientSeq: i, delta: encodeDelta(doc.updateShapes([{ id: "s", patch: { x: i } }])) }));
    }
    await until(() => closeCode !== 0, "flooder disconnected");
    expect(closeCode).toBe(4429);
  });
});
