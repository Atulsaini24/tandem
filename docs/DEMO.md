# Demo video script (~4 minutes)

The goal: in four minutes, show things most "collaborative app" demos can't. Each beat is a
claim, a visible proof, and one line of narration. Record at 1080p with two browser windows
side by side (Chrome + a second profile, or Chrome + Edge, so each has its own storage).

**Setup before recording**

```bash
pnpm db:up && pnpm dev                 # Postgres + Redis, web :5173, sync :8787
ollama pull gemma3:4b                  # once; warm it up with one request before recording
```

Open `http://localhost:5173/?doc=demo` in both windows. Light theme, 100% zoom.

---

## 1. It's real-time, and it's fast (0:00–0:35)
- Left window: press **R**, click to place a few shapes; drag one around.
- Right window: they appear and move live; the other person's **cursor glides** with a name tag.
- Click **+5,000**, then **Benchmark**.
- *Say:* "Five thousand shapes, five hundred moving every frame, and the main thread uses under
  4 ms a frame. The CRDT engine runs in a Web Worker, so collaboration never costs frames."

## 2. Offline first: refresh while offline (0:35–1:20)
- Left: click the sync pill → **Offline**. Move a shape, add a sticky note (**N**), type "made offline".
- Pill shows **Offline · 2 queued**. Right window doesn't change.
- **Reload the left page.** Toast: *"Restored 2 unsynced edits from your last session."*
- Click the pill → **online**. The right window updates instantly.
- *Say:* "Edits are journaled to IndexedDB in the same transaction as the sync cursor, so a
  refresh, a crash, or a dead battery can't lose them, or send them twice."

## 3. Conflicts resolve without a referee (1:20–2:00)
- Both windows: drag the **same shape** to different places at the same time → both end up
  agreeing on one result.
- Left: drag shape A. Right: drag shape A again, then drag shape B.
- Left: **Ctrl+Z** → toast *"1 change wasn't undone: someone else edited it since"*.
- *Say:* "Undo only reverts what's still yours. My Ctrl+Z can't overwrite a teammate's newer edit."

## 4. Time travel (2:00–2:40)
- Click **History**, drag the slider back: shapes glide back through every version.
- Pick an old version → **Restore this version** → **Ctrl+Z** to undo the restore.
- *Say:* "The server keeps every change and snapshots every 500, so any version rebuilds in
  milliseconds, and restoring is just another undoable edit."

## 5. Local AI (2:40–3:30)
- Click **✦ AI** → "Sprint retro: what went well, what didn't, action items" → **Create board**.
- Cards **appear one by one while the model is still writing**; the right window gets them too.
- **Ctrl+Z** once: the whole board disappears. **Ctrl+Shift+Z**: it's back.
- Place 6 sticky notes with tasks, select them → **Organize notes** → they slide into columns.
- *Say:* "It runs on my laptop, nothing leaves the device. The model only writes content;
  code does the layout and validates everything, so the model can't corrupt the document."

## 6. Under the hood (3:30–4:00)
- Show `DECISIONS.md` scrolling (47 decisions), then the README load-test table.
- Terminal: `pnpm check`, with 180+ tests passing.
- *Say:* "Every CRDT is fuzzed against a reference implementation with 10,000 random histories,
  and I break the code on purpose to prove the tests catch it."

---

**If something goes wrong on camera:** the AI's first request loads the model (~20 s), so warm it
up first. If the sync pill says *Reconnecting*, check `pnpm dev` is running both servers.
