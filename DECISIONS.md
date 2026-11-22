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

## D013 — Tree correctness is checked against a reference implementation
The test oracle is a 10-line naive version: sort every op by timestamp, replay from empty,
skip cycles. The real engine must equal it for every delivery order. Mutation checks:
removing the cycle check fails 3 tests; removing undo/redo (apply in arrival order, the
naive approach) fails 5, including the fuzz and order-independence properties.
