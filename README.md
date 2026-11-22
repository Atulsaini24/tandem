# Canvas: a local-first collaborative canvas, CRDT engine written from scratch

A multiplayer canvas (shapes, groups, z-order, text) where every edit works offline, survives
a page refresh, and merges with everyone else's — without a central "source of truth" deciding
conflicts. The sync engine is hand-written: no Yjs, no Automerge.

> **Interview summary:** "I wrote the CRDTs (HLC, LWW map, Kleppmann's move tree, Fugue text),
> proved convergence with property-based tests against reference implementations and with
> deliberately injected bugs, then built offline-first sync, selective undo, time travel, and a
> horizontally scaled server on top — and measured all of it."

## What's in it

| Layer | What | Where |
|---|---|---|
| **CRDT engine** | Hybrid Logical Clock, PN-counter, LWW register & map, move-tree (Kleppmann 2021), Fugue text (Weidner 2023), fractional indexing | [`packages/crdt`](packages/crdt) |
| **Document** | Shapes = tree node + LWW property map; selective undo/redo; restore-to-version | [`packages/doc`](packages/doc) |
| **Sync** | Binary wire format, cursor + outbox protocol, presence, IndexedDB journal, Web-Lock replica leases | [`packages/sync`](packages/sync) |
| **Server** | Ordered per-document delivery, group-commit Postgres log, snapshots, history, Redis fan-out across instances, signed tokens, rate limits | [`apps/server`](apps/server) |
| **App** | React 19 + PixiJS 8 canvas, engine in a Web Worker, live cursors, time-travel slider | [`apps/web`](apps/web) |

## How it fits together

```
 Browser tab                                    Server instance (×N)            Shared
┌───────────────────────────────┐              ┌──────────────────────┐
│ UI thread                     │              │ Room (per document)  │      ┌──────────┐
│  React · PixiJS · input       │              │  validate · rate     │──────│ Postgres │
│  Scene (optimistic mirror)    │              │  limit · group commit│      │ log +    │
│        ▲ patches   │ commands │   WebSocket  │  ordered delivery    │      │ snapshots│
│ ───────┼───────────▼───────── │   (binary)   │  history · presence  │      └──────────┘
│ Web Worker                    │◄────────────►│                      │      ┌──────────┐
│  CanvasDocument (CRDTs)       │              │                      │──────│  Redis   │
│  SyncClient (cursor, outbox)  │              └──────────────────────┘      │ pub/sub  │
│  IndexedDB journal            │                                            └──────────┘
└───────────────────────────────┘
```

- **Every edit is local first.** It applies to the worker's CRDT immediately, is journaled to
  IndexedDB in the same step, and is pushed to the server when there's a connection.
- **The server orders, it doesn't decide.** It numbers each document's deltas (1, 2, 3…), stores
  them, and relays them. Conflicts are resolved by the CRDTs, identically on every replica.
- **Reconnecting sends only what's missing:** the client says "I've seen up to N"; it gets N+1….
  Its outbox (unacknowledged edits) is resent; the server stores each edit exactly once.

## Run it

Requirements: Node 22+, pnpm 10, Docker (for Postgres/Redis; optional for plain dev).

```bash
pnpm install
pnpm db:up          # Postgres :5433 + Redis :6380 (docker compose)
pnpm dev            # web on :5173, sync server on :8787
```

Open `http://localhost:5173/?doc=demo` in two windows. Try: go offline (click the sync pill),
edit in both, refresh the offline one, go back online. Drag a shape, have the other window move
it, press Ctrl+Z. Open **History** and drag the slider.

Without `DATABASE_URL` the server keeps documents in memory. Configuration: see
[`.env.example`](.env.example) and [`apps/server/src/main.ts`](apps/server/src/main.ts).

```bash
pnpm check          # lint + typecheck + all tests (Postgres/Redis tests run if the env vars are set)
pnpm build
```

## Correctness

Every CRDT is tested three ways: named scenarios, algebraic laws (merge is commutative,
associative, idempotent), and **fuzzed convergence against an independent reference
implementation** — 10,000 random histories each, with skewed clocks and late, duplicated and
reordered delivery. Tests are themselves tested: each milestone injects plausible bugs
(e.g. "apply moves in arrival order", "ACK outside the ordered stream") and confirms they fail.

Highlights:
- **Move tree:** concurrent "A into B" and "B into A" never create a cycle; matches a
  sort-and-replay reference for every delivery order.
- **Text:** three people typing at the same spot (forward or backward) never interleave words.
- **Undo:** undoing all of Alice's edits never changes a property Bob currently owns
  (1,000 random interleavings).
- **Sync:** offline edits sync after reconnect with *only the missing deltas* — counted on the wire.
- **Multi-instance:** 3 servers with a bus that reorders and *loses* messages; every client still
  ends with exactly the store's full log applied.

## Performance

### Rendering (M4)

5,000 shapes on screen, 500 of them moving every frame through the real path (UI → worker →
patch → renderer) while panning and zooming: **main-thread work 2.9 ms median, 3.9 ms p95** per
frame — under a quarter of a 60 fps frame. The CRDT update for those 500 shapes takes 0.6 ms in
the worker, off the UI thread. (`Benchmark` button in the app.)

### Sync server (M8)

Load generator: real server **processes**, real Postgres (+ Redis for 2 instances), and
100–400 real `SyncClient`s — the same code the browser runs — each editing 10×/s. Latency is
end to end: an edit leaving one client → arriving at the other 4 clients on its document.
Every run ends with a correctness check: **0 diverged documents in every run below.**

| Run | Servers | Routing | Edits/s | Deliveries/s | p50 | p95 | p99 |
|---|---|---|---|---|---|---|---|
| A | 1 | — | 920 | 3,679 | **43 ms** | 67 ms | 79 ms |
| C | 1 | — | 1,937 | 7,748 | **90 ms** | 160 ms | 220 ms |
| E | 2 | by document | 1,958 | 7,831 | **76 ms** | 174 ms | 258 ms |
| B | 2 | split (worst case) | 980 | 3,921 | 77 ms | 193 ms | 232 ms |
| D | 2 | split (worst case) | 1,945 | 7,778 | 284 ms | 532 ms | 649 ms |
| G | 1 | — | 3,832 | 15,330 | 270 ms | 535 ms | 756 ms |
| F | 2 | by document | 3,678 | 14,713 | 300 ms | 576 ms | 790 ms |

What the numbers say:
- **Group commit was the big win.** Before it, the same 1,000 edits/s had a **p50 of 1,436 ms**
  and 2,000/s fell behind by 13 s: every delta was its own Postgres transaction (~4 round
  trips), serialized per document. Now edits that queue up while a transaction runs go in the
  next one together. (With an in-memory store the same load runs at p50 3 ms — that's how the
  database was identified as the bottleneck, rather than guessed.)
- **Route by document.** When one document's clients are split across instances, every edit
  crosses Redis and both instances contend on that document's lock (D: 3× the latency of C).
  When a load balancer hashes on doc id (E), the bus is idle and 2 instances match or beat 1.
  Redis then exists for correctness when clients do end up split — not for the hot path.
- **The ceiling here is the laptop, not the design.** Everything — 2 servers, Postgres, Redis
  and up to 400 clients — shares one 4-core i5-11300H (Windows, Docker Desktop). At 4,000
  edits/s, two instances don't beat one because they share the same CPU and database. The load
  generator itself starts lagging there too (event-loop p99 55 ms), so treat F/G as a lower
  bound on what the servers can do.

Reproduce: `pnpm db:up`, then
`pnpm --filter @canvas/server load -- --instances 2 --docs 40 --clients 5 --rate 10 --seconds 20 --routing affinity`.

## Design decisions

Every non-obvious choice — what was picked, what was rejected, and why, including the bugs that
changed the design — is in [`DECISIONS.md`](DECISIONS.md). Known gaps and next steps are in
[`LATER.md`](LATER.md).
