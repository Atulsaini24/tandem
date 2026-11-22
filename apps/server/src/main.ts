import { randomUUID } from "node:crypto";
import { RedisBus, type Bus } from "./bus.js";
import { PostgresStore } from "./postgres-store.js";
import { startSyncServer } from "./server.js";
import { MemoryStore, type Store } from "./store.js";

/**
 * Configuration (all optional):
 *   PORT          listen port (8787)
 *   DATABASE_URL  Postgres: durable log + snapshots (else: in memory, lost on restart)
 *   REDIS_URL     Redis: connect several instances (requires DATABASE_URL)
 *   AUTH_SECRET   require signed tokens (see auth.ts, and `pnpm token`)
 *   INSTANCE_ID   name of this instance in logs/health (random)
 */
const port = Number(process.env.PORT ?? 8787);
const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const authSecret = process.env.AUTH_SECRET;
const instanceId = process.env.INSTANCE_ID ?? `i-${randomUUID().slice(0, 8)}`;

if (redisUrl && !databaseUrl) {
  // Instances must share one log; separate in-memory stores would each number seqs alone.
  console.error("REDIS_URL needs DATABASE_URL: multiple instances must share one store");
  process.exit(1);
}

const store: Store = databaseUrl ? await PostgresStore.connect(databaseUrl) : new MemoryStore();
const bus: Bus | undefined = redisUrl ? await RedisBus.connect(redisUrl, instanceId) : undefined;
const server = await startSyncServer({
  port,
  store,
  ...(bus ? { bus } : {}),
  ...(authSecret ? { authSecret } : {}),
});

console.info(
  `sync server ${instanceId} on ws://localhost:${server.port}  (store: ${store.kind}, bus: ${bus ? "redis" : "none"}, auth: ${authSecret ? "tokens" : "open"})`,
);
if (!databaseUrl) console.info("no DATABASE_URL set: documents live in memory until the server stops");

async function shutdown(signal: string): Promise<void> {
  console.info(`${signal}: shutting down`);
  await server.close();
  await bus?.close();
  await store.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
