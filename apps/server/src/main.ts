import { PostgresStore } from "./postgres-store.js";
import { startSyncServer } from "./server.js";
import { MemoryStore, type Store } from "./store.js";

const port = Number(process.env.PORT ?? 8787);
const databaseUrl = process.env.DATABASE_URL;

const store: Store = databaseUrl ? await PostgresStore.connect(databaseUrl) : new MemoryStore();
const server = await startSyncServer({ port, store });

console.info(`sync server on ws://localhost:${server.port}  (store: ${store.kind})`);
if (!databaseUrl) console.info("no DATABASE_URL set: documents live in memory until the server stops");

async function shutdown(signal: string): Promise<void> {
  console.info(`${signal}: shutting down`);
  await server.close();
  await store.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
