# Later

Ideas that are out of scope for the current milestone. Nothing here gets built until
the current milestone passes its gate.

- **Clean up abandoned replica records:** every concurrently-open tab leaves a replica in
  IndexedDB. Drop records whose outbox is empty and which haven't been used in N days.
- **Per-tab presence names:** tabs in the same browser share one identity ("Sunny Lynx"
  twice). Fine for real multi-user use; add a tab suffix or real accounts (M8).
- **Idle cursors:** fade a peer's cursor after ~30s without movement.
- **Snapshot cost on big docs:** compaction re-encodes the whole document (in the worker).
  Fine at 5k shapes; at 100k, snapshot incrementally or on idle.
- **Persistent storage permission:** call `navigator.storage.persist()` so the browser
  doesn't evict IndexedDB under storage pressure.
- **History request cost:** each slider position rebuilds the state on the server (snapshot +
  up to 500 deltas). Cache recent states per room, and/or snapshot more densely.
- **Snapshot work blocks the room queue:** building a snapshot runs inside the document's
  queue. Move it to an idle task off the critical path.
- **History while offline:** time travel needs the server. Locally journaled history could
  give a recent-history view offline.
- **Named versions:** let people label a version ("before the redesign") and jump to it.
- **Coalesce drag deltas in the outbox:** a drag pushes ~60 deltas/s. Consecutive LWW writes
  to the same keys could be merged before sending.
- **Sign-in UI:** the server verifies tokens, and the web app passes `?token=`, but there's
  no login screen or token-issuing backend yet. Viewers also see editing tools that the
  server will reject; the UI should go read-only for them.
- **Stale remote presence:** if an instance crashes, its clients' cursors stay visible on
  other instances (no LEAVE is sent). Give presence a TTL / heartbeat.
- **Room cleanup:** rooms (and their Redis subscriptions) are never removed after the last
  client leaves.
- **Load test on real hardware:** separate machines for servers, Postgres and generators, to
  measure actual horizontal scaling (one laptop shares CPU between everything).
- **uWebSockets.js:** still not needed; the database was the bottleneck, not the socket layer
  (D026).
- **Tombstone garbage collection (M7/M8):** drop tombstones once every replica is known to
  have seen them (causal stability). Needs version vectors from the sync layer.
- **Move-log truncation (M8):** once an op is causally stable (every replica has seen
  everything before it), its undo info can be dropped and the log compacted to a snapshot.
- **Fractional keys grow on repeated appends:** adding shapes one at a time at the end adds
  about one character every ~6 inserts. Switch to keys with a variable-length integer part
  (like the "a0" scheme) so appends stay O(log n) long. Bulk creates already bisect.
- **Viewport culling + R-tree:** not needed at 5,000 batched sprites; revisit at 50k+, or
  when shapes get real vector paths.
- **Code-split the web bundle:** main chunk is 639 kB (201 kB gzip), mostly Pixi + React +
  Motion. Lazy-load the WebGPU renderer and non-critical UI.
- **Dark mode for the canvas:** UI tokens exist; Pixi background and grid colors are
  constants for now.
- **ESLint React rules:** add eslint-plugin-react-hooks once the UI grows.
- **Text performance (when docs get long):** every edit re-walks the whole tree (O(n)),
  and each character is its own node. Fine for sticky notes; for long docs, cache an
  order-statistic tree for index → node lookups and store typed runs as one node.
- **Stable cursors (M6):** remote cursors should anchor to a character id, not an index,
  so they don't jump when others type before them.
- **Rich text (beyond M10):** bold/italic spans as Peritext-style marks over Fugue ids.
- **Copy-free state snapshots:** `state` currently exposes the internal Map as a read-only
  view. Fine for now; revisit when the engine moves into a Web Worker (M4).
