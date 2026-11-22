/**
 * Load test: real server processes, real Postgres (+ Redis for >1 instance), many real
 * SyncClients (the same code the browser runs).
 *
 *   pnpm --filter @canvas/server load -- --instances 2 --docs 20 --clients 5 --rate 10 --seconds 20
 *
 * Measures end-to-end latency (an edit leaves one client → arrives at the others), acked
 * throughput, and, because numbers mean nothing if the result is wrong, checks that every
 * client of every document converged to the same state.
 *
 * Note: all clients share this one process, so latency includes client-side queueing.
 * Treat the numbers as an upper bound on what the servers add.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CanvasDocument, type ShapeProps } from "@canvas/doc";
import { SyncClient } from "@canvas/sync";

const { values } = parseArgs({
  options: {
    instances: { type: "string", default: "1" },
    docs: { type: "string", default: "20" },
    clients: { type: "string", default: "5" },
    rate: { type: "string", default: "10" },
    seconds: { type: "string", default: "20" },
    "base-port": { type: "string", default: "9100" },
    /** "postgres" (default) or "memory" (1 instance only): isolates the database's cost. */
    store: { type: "string", default: "postgres" },
    /**
     * "spread": each document's clients split across instances (worst case: every edit
     * crosses the bus, instances contend on the same per-document lock).
     * "affinity": a document's clients all land on one instance (what a load balancer
     * hashing on doc id gives you).
     */
    routing: { type: "string", default: "spread" },
  },
});
const STORE = values.store;
if (STORE === "memory" && Number(values.instances) > 1) throw new Error("--store memory needs --instances 1");
const INSTANCES = Number(values.instances);
const DOCS = Number(values.docs);
const CLIENTS = Number(values.clients);
const RATE = Number(values.rate);
const SECONDS = Number(values.seconds);
const BASE_PORT = Number(values["base-port"]);
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://canvas:canvas-dev@localhost:5433/canvas";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6380";

const serverDir = fileURLToPath(new URL("..", import.meta.url));
const now = (): number => performance.timeOrigin + performance.now();
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}

// --- servers ---------------------------------------------------------------

async function startInstances(): Promise<{ urls: string[]; children: ChildProcess[] }> {
  const children: ChildProcess[] = [];
  const urls: string[] = [];
  for (let i = 0; i < INSTANCES; i++) {
    const port = BASE_PORT + i;
    const child = spawn(process.execPath, ["--conditions=source", "--import", "tsx", "src/main.ts"], {
      cwd: serverDir,
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "DATABASE_URL" && key !== "REDIS_URL")),
        PORT: String(port),
        INSTANCE_ID: `load-${i}`,
        ...(STORE === "postgres" ? { DATABASE_URL } : {}),
        ...(INSTANCES > 1 ? { REDIS_URL } : {}),
      },
      stdio: ["ignore", "ignore", "inherit"],
    });
    children.push(child);
    urls.push(`ws://127.0.0.1:${port}`);
    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break;
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) throw new Error(`instance ${i} did not start`);
      await sleep(100);
    }
  }
  return { urls, children };
}

async function health(index: number): Promise<{ pushes: number; rssMb: number; fromBus: number }> {
  const response = await fetch(`http://127.0.0.1:${BASE_PORT + index}/health`);
  return (await response.json()) as { pushes: number; rssMb: number; fromBus: number };
}

// --- clients ---------------------------------------------------------------

interface LoadClient {
  readonly name: string;
  readonly docId: string;
  readonly doc: CanvasDocument;
  readonly sync: SyncClient;
}

const latencies: number[] = [];
let deliveries = 0;
const SHAPES_PER_DOC = 10;
const rect = (x = 0): ShapeProps => ({ kind: "rect", x, y: 0, w: 10, h: 10, fill: 0x2f63ff });

function makeClient(url: string, docId: string, name: string): LoadClient {
  const doc = new CanvasDocument(name);
  const sync = new SyncClient({
    url,
    docId,
    clientId: name,
    onDelta: (delta) => {
      doc.merge(delta);
      // Each timed edit writes y = send time (ms). Another client's y → end-to-end latency.
      const arrived = now();
      for (const [, entries] of delta.props) {
        const y = entries.get("y");
        if (y && !y.deleted && typeof y.value === "number" && y.value > 1e12 && y.ts.replica !== name) {
          latencies.push(arrived - y.value);
          deliveries += 1;
        }
      }
    },
  });
  sync.start();
  return { name, docId, doc, sync };
}

async function until(condition: () => boolean, what: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await sleep(20);
  }
}

// --- run -------------------------------------------------------------------

async function main(): Promise<void> {
  const runId = Math.random().toString(36).slice(2, 8);
  console.log(`load test: ${INSTANCES} instance(s), ${DOCS} docs × ${CLIENTS} clients, ${RATE} edits/s each, ${SECONDS}s`);
  const { urls, children } = await startInstances();
  try {
    const clients: LoadClient[] = [];
    for (let d = 0; d < DOCS; d++) {
      for (let c = 0; c < CLIENTS; c++) {
        const slot = values.routing === "affinity" ? d : d + c;
        const url = urls[slot % urls.length] ?? urls[0] ?? "";
        clients.push(makeClient(url, `load-${runId}-${d}`, `c${d}x${c}`));
      }
    }
    await until(() => clients.every((c) => c.sync.status === "online"), "all clients online");

    // Seed each doc with shapes; every client edits its own shape(s) during the run.
    for (let d = 0; d < DOCS; d++) {
      const owner = clients[d * CLIENTS];
      owner?.sync.push(owner.doc.createShapes(Array.from({ length: SHAPES_PER_DOC }, (_, i) => ({ id: `s${i}`, props: rect(i) }))));
    }
    await until(() => clients.every((c) => c.doc.shapes().length === SHAPES_PER_DOC), "seeded");
    latencies.length = 0;
    deliveries = 0;

    const pushesBefore = (await Promise.all(urls.map((_, i) => health(i)))).reduce((n, h) => n + h.pushes, 0);
    // If THIS process (all the clients) can't keep up, latency measures the generator, not the servers.
    const loopDelay = monitorEventLoopDelay({ resolution: 10 });
    loopDelay.enable();
    const started = now();
    let sent = 0;
    const interval = 1000 / RATE;
    // Stagger clients across the interval so load is smooth, not one spike per tick.
    const timers = clients.map((client, i) =>
      setTimeout(() => {
        const timer = setInterval(() => {
          if (now() - started > SECONDS * 1000) return;
          const shape = `s${i % SHAPES_PER_DOC}`;
          client.sync.push(client.doc.updateShapes([{ id: shape, patch: { x: Math.random() * 1000, y: now() } }]));
          sent += 1;
        }, interval);
        timers.push(timer);
      }, (i * interval) / clients.length),
    );
    await sleep(SECONDS * 1000);
    for (const timer of timers) clearInterval(timer);
    loopDelay.disable();
    const elapsed = (now() - started) / 1000;

    // Drain: everything acked, then every client at its doc's head.
    await until(() => clients.every((c) => c.sync.pending === 0), "all pushes acked");
    const drainedAt = now();
    const heads = new Map<string, number>();
    for (const c of clients) heads.set(c.docId, Math.max(heads.get(c.docId) ?? 0, c.sync.cursor));
    await until(() => clients.every((c) => c.sync.cursor >= (heads.get(c.docId) ?? 0)), "all clients caught up");

    // Correctness: every client of a document holds the same shapes.
    let diverged = 0;
    for (let d = 0; d < DOCS; d++) {
      const group = clients.filter((c) => c.docId === `load-${runId}-${d}`);
      const reference = JSON.stringify(group[0]?.doc.shapes());
      if (group.some((c) => JSON.stringify(c.doc.shapes()) !== reference)) diverged += 1;
    }

    const healths = await Promise.all(urls.map((_, i) => health(i)));
    const acked = healths.reduce((n, h) => n + h.pushes, 0) - pushesBefore;
    const sorted = [...latencies].sort((a, b) => a - b);
    const result = {
      store: STORE,
      routing: values.routing,
      instances: INSTANCES,
      clients: clients.length,
      docs: DOCS,
      editsPerSecTarget: clients.length * RATE,
      editsSent: sent,
      editsAckedPerSec: Math.round(acked / elapsed),
      deliveriesPerSec: Math.round(deliveries / elapsed),
      latencyMs: {
        p50: Math.round(percentile(sorted, 0.5) * 10) / 10,
        p95: Math.round(percentile(sorted, 0.95) * 10) / 10,
        p99: Math.round(percentile(sorted, 0.99) * 10) / 10,
        max: Math.round((sorted.at(-1) ?? 0) * 10) / 10,
      },
      drainMs: Math.round(drainedAt - started - elapsed * 1000),
      generatorLoopDelayMs: {
        p50: Math.round(loopDelay.percentile(50) / 1e6),
        p99: Math.round(loopDelay.percentile(99) / 1e6),
        max: Math.round(loopDelay.max / 1e6),
      },
      crossedBus: healths.reduce((n, h) => n + h.fromBus, 0),
      serverRssMb: healths.map((h) => h.rssMb),
      divergedDocs: diverged,
    };
    console.log(JSON.stringify(result, null, 2));
    for (const c of clients) c.sync.stop();
    if (diverged > 0) process.exitCode = 1;
  } finally {
    for (const child of children) child.kill();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
