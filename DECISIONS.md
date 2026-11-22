# Engineering decisions

Every non-obvious tradeoff goes here: what we chose, what we rejected, and why.

## D001 — Engine first, UI second
The CRDT engine lives in `packages/crdt` with no DOM, network or storage dependencies.
If the engine is wrong, everything built on it is wrong, so it is built and proven
(property-based convergence tests) before any canvas or server exists.

## D002 — Monorepo (pnpm workspaces + Turborepo)
The engine, wire protocol, web app and sync server share types. One repo keeps them
in lockstep; Turborepo caches builds and runs tasks in dependency order.

## D003 — Hybrid Logical Clocks instead of wall clocks or Lamport clocks
- **Wall clocks** (`Date.now()`) are wrong on real devices: they drift and jump backwards.
  A user whose laptop is 2 minutes behind would "lose" every edit war.
- **Lamport clocks** fix ordering but carry no real time, so we can't show "edited 3 min
  ago" or do time-travel by date.
- **HLC** keeps physical time when it can and falls back to a logical counter when it
  can't. After observing a remote timestamp, every later local timestamp is greater,
  so "I saw your change, then changed it" always wins, whatever the clocks say.
- Ties are broken by replica id, which makes timestamps globally unique and gives a total
  order. **Requirement:** replica ids must be unique per tab/device.

## D004 — Delta-state CRDTs
Each mutation returns a small *delta*, which is itself a valid state, merged with the same
join function as full states.
- vs **operation-based**: op-based needs exactly-once, causally-ordered delivery from the
  network. Delta-state tolerates loss, duplicates and reordering, because merge is
  commutative, associative and idempotent (tested as semilattice laws).
- vs **full state-based**: we never ship the whole document per edit, only the delta.
- Same merge for deltas and full snapshots means sync-on-reconnect is just "merge the
  other side's state".

## D005 — Last-Writer-Wins per property, not per object
A shape is an LWW map: each property (x, y, color...) resolves independently. Two users
changing color and position at the same time both keep their change. LWW is the right
semantic for scalar properties; it is the WRONG semantic for text (D-later: Fugue) and for
tree moves (D-later: Kleppmann move op).

## D006 — Deletes are tombstones
A delete is stored as a timestamped tombstone, so a delete beats an older `set` that
arrives later over the network. Cost: tombstones accumulate (garbage collection is in
LATER.md and needs causal-stability info from the sync layer).

## D007 — How correctness is tested
Three layers, all on every CRDT:
1. **Unit tests** for named scenarios (causality, late delete, concurrent writes).
2. **Semilattice laws** via property-based tests on random states.
3. **Convergence fuzzing**: 3 replicas with skewed and backwards-jumping clocks, random
   interleaving of edits and deliveries (late, duplicated, self-delivered), then every
   replica receives everything twice in its own random order. Checked against an
   **oracle** (the true total / the globally-latest write), not just "replicas agree",
   because replicas can agree on the wrong answer. 10,000 histories per CRDT.
4. **Mutation check**: deliberately breaking `mergeInto` to "last arrival wins" makes the
   suite fail with a shrunk 2-write counterexample, so the tests can actually catch bugs.

## D008 — Tree moves use Kleppmann's undo-do-redo algorithm
Problem: Alice moves A into B while Bob moves B into A. Applying both creates a cycle and
the subtree disappears from the document. Alternatives considered:
- **LWW on `parent`**: converges, but can still form cycles (each replica accepts both).
- **Lock / server decides**: breaks offline editing, which is the whole point.
- **Kleppmann et al. 2021 (chosen)**: keep a timestamp-ordered op log; a late op is
  inserted into the past by undoing newer ops, applying it, and redoing them. Any op that
  would create a cycle *at its point in history* is skipped. Every replica makes the same
  skip decisions, so all trees are identical and acyclic.
- Fits D004: state = set of move ops, merge = set union, tree = pure function of the set.
- Cost: a late op costs O(number of newer ops) undo/redo. The log grows forever until
  truncation (LATER.md).

## D009 — Structure and properties are separate CRDTs
The move tree only stores `parent` and sibling `position`. Shape properties (x, y, color,
text...) live in a per-node LWW map. Moving a shape and recoloring it concurrently never
conflict, and the tree log stays small.

## D010 — Sibling order with fractional indexing
z-order is a base-62 string between neighbours (`positionBetween`). Reordering one shape
writes one value instead of renumbering every sibling. Concurrent inserts in the same gap
may get equal positions; ties are broken by node id, so order is still deterministic.

## D011 — Local cycles are errors, remote cycles are silent skips
A user can't drop a group into itself: `move()` throws `TreeCycleError` and the UI blocks
it. But a remote op that creates a cycle *because of concurrency* is legal and must be
skipped deterministically. Throwing there would make replicas diverge.

## D012 — Delete is a move to TRASH
Deleting is a move, so it goes through the same conflict logic, takes the subtree with
it, and is undoable (move it back). A concurrent "move into deleted group" stays in TRASH.

## D014 — Text uses Fugue, not RGA, YATA or OT
- **OT** (Google Docs style) needs a central server to transform ops. It doesn't work
  peer-to-peer or offline-first.
- **RGA / Logoot / LSEQ** converge, but concurrent text typed at the same spot can
  *interleave*: "hello" + "world" → "hweolrllod". RGA does this for backward typing.
- **YATA (Yjs)** avoids most interleaving, but is harder to reason about.
- **Fugue (Weidner & Kleppmann 2023, chosen)**: characters form a tree of left and right
  children. A run of typing builds its own chain, and an in-order walk emits whole
  subtrees, so concurrent runs stay contiguous whether typed forward or backward.
  Simple rules, proven non-interleaving.

## D015 — Text state is two grow-only sets
State = (set of inserted characters, set of deleted ids). Merge is set union, and the
text is a pure function of the state, which fits D004. Two ordering problems are handled
inside merge instead of requiring a causally-ordered network:
- an insert whose parent hasn't arrived waits in a **pending buffer**;
- a delete that overtakes its insert is recorded anyway (tombstone first).
Deleted characters stay in the tree as tombstones, because later inserts may be anchored
to them.

## D016 — Text is tested three ways
1. **Model-based**: on one replica, every random edit sequence matches a plain JS string.
2. **No interleaving**: 3 replicas type words (forward or backward) at the same spot;
   every word must appear unbroken. 5,000 cases.
3. **Convergence vs a from-scratch rebuild**: 10,000 fuzzed histories.
Mutation checks: the naive "always attach right" rule fails 6 tests, including backward
interleaving and the string model; storing siblings in arrival order fails 4, including
the fuzz.

## D017 — The engine runs in a Web Worker; the UI thread keeps an optimistic mirror
CRDT work (HLC, op logs, undo/redo on late ops, merges) never runs on the UI thread, so a
burst of remote ops in M5 can't drop frames. The UI thread holds `Scene`: plain shape
objects that local edits update *immediately*. Each command carries a sequence number;
the worker echoes it on its patch, and a patch older than the latest local edit of a shape
is ignored, so dragging never snaps back to a stale position. Drag updates are coalesced
to one engine command per frame.

## D018 — Shapes are tinted sprites of shared textures
Each shape is a `Sprite` of `Texture.WHITE` (rect) or one generated circle texture
(ellipse), colored with `tint` and sized by scale. Same texture means Pixi batches thousands
of shapes into a few draw calls, and moving a shape is a transform change with no geometry
rebuild. Tradeoff: ellipse edges come from a 256px texture, so they soften at extreme zoom.
Real vector paths, when needed, become a separate render path.

## D019 — Own hit-testing; Pixi's event system is off
`stage.eventMode = "none"`. Hit-testing is a reverse z-order loop in world coordinates
(`hit-test.ts`): exact ellipse hits instead of bounding boxes, unit-testable without a
browser, and no per-event walk of 5,000 display objects. When counts outgrow a linear
scan, an R-tree drops in behind the same functions.

## D020 — Document model = composition of CRDTs (`packages/doc`)
A shape is a MoveTree node (structure + z-order) plus an LWWMap (properties), sharing
one HLC. Remote property data is untrusted: anything incomplete or malformed reads as
"not renderable" instead of crashing. Bulk creates use `positionsBetween` (bisection), so
5,000 shapes get z-keys of at most 6 characters instead of hundreds.

## D021 — Workspace packages resolve to TypeScript source in dev
Each package's `exports` lists a `"source"` condition first. Vite, Vitest and `tsc`
(`customConditions`) resolve it to `src/*.ts`, so editing the engine hot-reloads the app
and tests and typechecks need no build step. Node and published builds use
`dist/` via the default condition.

## D022 — Performance is measured, not eyeballed
`editor.benchmark()` drags 500 shapes along a circle through the real path (Scene → worker
→ patch → renderer) while panning and oscillating zoom for 5s.

**The gate is main-thread work per frame, not fps.** FPS is capped by the display and by
how the browser schedules the page. The first version of the gate ("avg ≥ 55 fps") failed
in the embedded preview pane, which delivers ~30 frames/s even to an EMPTY page, so it
was blaming the app for the monitor. Now the benchmark brackets each frame with ticker
hooks (first callback → after Pixi's render) and the gate is:
**p95 main-thread work ≤ 8 ms**, half of the 16.7 ms a 60fps frame allows, leaving the
other half for GPU and compositor. FPS is still reported, labelled "display".

Measured (M4, 5,000 shapes, 500 moved per frame, pan + zoom, preview pane):
- frame work: **2.9 ms median, 3.9 ms p95** → PASS, ~4× headroom vs 60fps
- worker: **0.6 ms** per 500-shape update (off the UI thread)
- fps equal to the empty-page baseline (~31 in that pane): the app costs no frames
- 5,000 shapes created and drawn end to end in 235 ms

## D023 — Sync = server sequence numbers + client outbox
The server appends every accepted delta to a per-document log and numbers it 1, 2, 3...
- **Cursor:** each client remembers the highest number it has seen. On reconnect it sends
  `HELLO since=N` and gets exactly the deltas after N. That's the whole catch-up protocol:
  no version-vector diffing, no full-state exchange.
- **Outbox:** local deltas stay queued until ACKed and are resent on every connect.
  The server stores each `(clientId, clientSeq)` once (UNIQUE constraint in Postgres), so
  a resend after a lost ACK is harmless. CRDT merges are idempotent anyway; this keeps the
  log clean.
- **Ordering:** one async queue per document (`Room`) does reading the backlog, joining
  the broadcast set, appending and relaying. So no delta can slip in between a client's
  backlog and its live stream: nothing is missed or sent twice.
- Considered: exchanging version vectors or state diffs peer-to-peer. That's more general,
  but costs more per reconnect and still needs a durable place for offline peers. A central
  log makes the server the natural place for auth, validation and persistence (M7/M8).

## D024 — Binary wire format with a string table
Varints, plus a per-message string table (replica ids, node ids and keys stored once,
then referenced by index), plus tagged values. **A 5,000-shape create is 755 KB vs 5.0 MB
as JSON (15%).** The server stores and relays the exact bytes a client pushed, with no
re-encoding. Decoding is hostile-input-safe: bounds-checked reads, counts checked against
the remaining bytes (a forged length can't allocate gigabytes), and only `DecodeError` is
ever thrown (fuzzed with random bytes and every truncation of valid input). The property
test caught a real bug: 2^52 passed the "compact int" check but zigzags to 2^53, past the
safe-integer limit.

## D025 — The server validates every push
Before a delta reaches the log: it must decode; every timestamp's replica must equal the
connection's clientId (a client can't forge someone else's edits); and no timestamp may
be more than 60s in the future (one broken clock would otherwise drag every HLC forward
forever, the clock-drift item from LATER.md). Rejection is fatal for that connection only;
other clients are unaffected (tested).

## D026 — `ws`, not uWebSockets.js (for now)
uWS installs prebuilt native binaries from GitHub, not npm. Nothing measured so far says
the socket layer is the bottleneck: the CRDT merge runs on clients, and the server only
validates and relays bytes. The transport is confined to `server.ts`; M8's load test
decides whether swapping is worth it.

## D027 — Edits never wait for a repaint
Found in the two-tab test: drag moves were batched to "next animation frame", but browsers
pause frames in background tabs, so a move made just before switching tabs never left
the tab. The fix sends queued moves on the next frame or after 50ms (whichever is
first), and immediately when the page becomes hidden. Rendering cadence and data
durability are now independent.

## D028 — Sync is tested at the wire, not just at the result
The gate counts DELTA messages *as they arrive*, before the client's own "already seen"
filter. Otherwise a server that resent the whole history would pass, because the client
quietly drops the duplicates. Mutation checks: ignoring `since`, dropping dedupe, skipping
the replica check, and not resending the outbox each fail at least one test.

## D029 — One contract test suite for every Store
`store.test.ts` runs the same contract (per-document numbering, dedupe, exact tail reads,
bytes intact up to 70 KB, survives a reconnect) against `MemoryStore` and `PostgresStore`.
The fast in-memory store used by the other server tests is only trustworthy if it behaves
exactly like the production store, and this suite is what makes it so. Postgres tests run when
`DATABASE_URL` is set: locally via `pnpm db:up` (docker-compose, port 5433), and in CI
via a Postgres service container. A second suite runs the M5 gate end to end over
Postgres, including a full server + connection-pool restart.

Dedupe has two layers: `ON CONFLICT DO NOTHING` makes a resend a clean "duplicate", and
the `UNIQUE (doc_id, client_id, client_seq)` constraint refuses to store a duplicate even
if that clause is removed (mutation-tested: 2 contract tests fail with a constraint error).

## D013 — Tree correctness is checked against a reference implementation
The test oracle is a 10-line naive version: sort every op by timestamp, replay from empty,
skip cycles. The real engine must equal it for every delivery order. Mutation checks:
removing the cycle check fails 3 tests; removing undo/redo (apply in arrival order, the
naive approach) fails 5, including the fuzz and order-independence properties.
