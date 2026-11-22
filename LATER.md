# Later

Ideas that are out of scope for the current milestone. Nothing here gets built until
the current milestone passes its gate.

- **Clock-drift guard (M5):** a malicious or broken client could send a timestamp years in
  the future and drag every HLC forward. Reject remote timestamps more than N seconds ahead
  at the server boundary, NOT inside `merge` (rejecting inside merge would break convergence).
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
