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
- **Collaborative text inside notes:** text now streams to others as you type (every
  ~150ms), but labels are still last-writer-wins strings: two people typing in the SAME note
  at the same moment → one wins. The Fugue text CRDT (M3) is built and tested; wiring it into
  notes (per-character inserts, remote carets) is the next step.
- **Text rendering at high zoom:** labels are canvas text textures and blur when zoomed far
  in. Use MSDF/bitmap fonts, or re-render at zoom thresholds.
- **AI: smarter organize:** gemma3:4b sometimes uses many columns for few notes (6 for 8).
  Steer with a "max columns ≈ notes/2" hint, or let the user pick the columns.
- **AI: model choice in the UI** (env vars only today: VITE_OLLAMA_URL, VITE_OLLAMA_MODEL).
- **Sign-in UI:** the server verifies tokens, and the web app passes `?token=` (viewers get a
  read-only UI), but there's no login screen or token-issuing backend yet.
- **Mobile layout:** the toolbar adapts down to ~800px; phones need a compact toolbar and
  touch gestures (pinch-zoom, two-finger pan).
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
- **Code-split further:** pages are lazy chunks now (the homepage doesn't load Pixi or the
  engine); the board chunk is still one piece. Lazy-load the command palette, AI panel and
  export code.
- **ESLint React rules:** add eslint-plugin-react-hooks once the UI grows.
- **Text performance (when docs get long):** every edit re-walks the whole tree (O(n)),
  and each character is its own node. Fine for sticky notes; for long docs, cache an
  order-statistic tree for index → node lookups and store typed runs as one node.
- **Stable cursors (M6):** remote cursors should anchor to a character id, not an index,
  so they don't jump when others type before them.
- **Rich text (beyond M10):** bold/italic spans as Peritext-style marks over Fugue ids.
- **Copy-free state snapshots:** `state` currently exposes the internal Map as a read-only
  view. Fine for now; revisit when the engine moves into a Web Worker (M4).
- **Comment threads:** a comment is one pinned note today. Replies, resolve, and @mentions
  need a small thread model (a list CRDT of messages per comment).
- **Image paste and upload:** paste text works (it becomes a note); images need blob storage
  on the server and a texture cache in the renderer.
- **Elbow connectors and arrow styles:** connectors are straight with one head. Orthogonal
  routing around shapes, curved style, and dashed lines.
- **Snapping while rotated:** alignment guides only apply to unrotated boxes.
- **Real PDF export:** PDF goes through the browser's print dialog. A direct vector PDF writer
  would skip the dialog.
- **Board registry across devices:** the dashboard lists boards this browser has opened. With
  sign-in, list them from the server.
- **3D rotation and height:** objects move along the ground; a rotate/raise gizmo would finish
  the set.
- **Layers panel:** rename, lock and hide per layer; drag to reorder.
