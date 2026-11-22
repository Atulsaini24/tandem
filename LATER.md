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
- **Children index (M4):** `children()` scans every node (O(n)). Keep a parent → children
  index updated in `#apply`/`#undo` before rendering 5,000 shapes.
- **Copy-free state snapshots:** `state` currently exposes the internal Map as a read-only
  view. Fine for now; revisit when the engine moves into a Web Worker (M4).
