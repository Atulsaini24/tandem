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
- **Log compaction / snapshots (M7):** a new client replays the whole delta log. Periodically
  snapshot the merged state, and serve snapshot + tail.
- **Coalesce drag deltas in the outbox:** a drag pushes ~60 deltas/s. Consecutive LWW writes
  to the same keys could be merged before sending.
- **Auth + per-doc permissions (M8):** anyone who knows a doc id can join it today.
- **Rate limits and max deltas per message (M8).**
- **Multi-instance seq assignment (M8):** `max(seq)+1` is safe with one server per doc; use
  a per-doc lock/sequence or route each doc to one instance.
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
