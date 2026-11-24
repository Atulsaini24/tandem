import type { NodeId, ShapeView } from "@canvas/doc";
import { layoutDiagram, type DiagramNode, type NodeShape } from "@canvas/ai";
import { useUiStore } from "../state/ui-store";
import { chartFromTable } from "./csv-chart";
import type { Editor } from "./editor";
import { prepareImage } from "./image";
import { embedFromUrl, parsePoll, tally, type EmbedSpec } from "./widgets";

/**
 * Board actions that don't need the AI: importing a table as a chart, embeds, code
 * blocks, live polls, and "Tidy up". They only use the editor's public API, so every one
 * is a normal, synced, undoable edit.
 */

const place = (editor: Editor, w: number, h: number): { x: number; y: number } => {
  const c = editor.freeSpotCenter(w, h);
  return { x: c.x - w / 2, y: c.y - h / 2 };
};

const reveal = (editor: Editor, id: NodeId, w: number, h: number): void => {
  const s = editor.scene.get(id);
  if (s) editor.renderer.fitTo({ x: s.x - 60, y: s.y - 60, w: w + 120, h: h + 120 }, 40, 0, 1, 700, true);
  editor.select([id]);
  useUiStore.getState().reveal([id]);
};

/** A dropped or pasted table becomes a designed chart. Returns false if it isn't a table. */
export function importTable(editor: Editor, text: string, name = "Pasted table"): boolean {
  const data = chartFromTable(text, name);
  if (!data || editor.locked) return false;
  const h = Array.isArray(data.kpis) && data.kpis.length > 0 ? 600 : 520;
  const { x, y } = place(editor, 860, h);
  const id = editor.aiCreate({ kind: "chart", x, y, w: 860, h, fill: 0x2f63ff, label: String(data.title), data: JSON.stringify(data) }, editor.beginGroup());
  reveal(editor, id, 860, h);
  useUiStore.getState().setNotice(`Made a ${String(data.type)} chart from ${name} — double-click it to edit`);
  return true;
}

/** Looks like spreadsheet rows (several lines, tabs or commas, some numbers). */
export function looksLikeTable(text: string): boolean {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 3) return false;
  const sep = lines[0]?.includes("\t") ? "\t" : ",";
  const cells = lines.map((l) => l.split(sep));
  return cells.every((c) => c.length >= 2) && cells.slice(1).some((c) => c.slice(1).some((v) => /^\s*[-\d.,$₹€£%]+\s*$/.test(v)));
}

/** A photo was dropped or pasted: shrink it and offer Photo → board. */
export async function offerPhoto(file: Blob): Promise<void> {
  try {
    const image = await prepareImage(file);
    useUiStore.getState().setPhotoOffer(image);
  } catch {
    useUiStore.getState().setNotice("Couldn't read that image.");
  }
}

export function addEmbed(editor: Editor, spec: EmbedSpec): NodeId | undefined {
  if (editor.locked) return undefined;
  const w = spec.type === "code" ? 720 : 800;
  const h = spec.type === "code" ? Math.min(640, 90 + spec.code.split("\n").length * 21) : spec.type === "youtube" ? 490 : 560;
  const { x, y } = place(editor, w, h);
  const id = editor.aiCreate({ kind: "embed", x, y, w, h, fill: 0x111318, label: spec.title || spec.url, data: JSON.stringify(spec) }, editor.beginGroup());
  reveal(editor, id, w, h);
  return id;
}

/** A pasted https link becomes a live embed. */
export function embedLink(editor: Editor, text: string): boolean {
  const t = text.trim();
  if (!/^https:\/\/\S+$/.test(t)) return false;
  const spec = embedFromUrl(t);
  if (!spec) return false;
  addEmbed(editor, spec);
  return true;
}

export function addPoll(editor: Editor, question: string, options: readonly string[]): NodeId | undefined {
  if (editor.locked) return undefined;
  const opts = options.map((o) => o.trim()).filter(Boolean).slice(0, 6);
  if (opts.length < 2) return undefined;
  const w = 560;
  const h = 150 + opts.length * 58;
  const { x, y } = place(editor, w, h);
  const id = editor.aiCreate({ kind: "poll", x, y, w, h, fill: 0x2a1745, label: question, data: JSON.stringify({ question, options: opts }) }, editor.beginGroup());
  reveal(editor, id, w, h);
  return id;
}

/** Vote in a poll (switching moves your one vote). */
export function votePoll(editor: Editor, id: NodeId, option: number): void {
  const shape = editor.scene.get(id);
  const spec = shape?.kind === "poll" ? parsePoll(shape.data) : undefined;
  if (!shape || !spec) return;
  const me = editor.voterId;
  const current = tally(spec, shape.voters).mine(me);
  if (current !== undefined) editor.engine.send({ type: "vote", seq: editor.engine.nextSeq(), id, voter: `${me}#${current}`, on: false });
  if (current !== option) editor.engine.send({ type: "vote", seq: editor.engine.nextSeq(), id, voter: `${me}#${option}`, on: true });
}

const TIDY_GAP = 40;

/**
 * Tidy up the selection (or the whole board): connected shapes get a clean layered
 * diagram layout; loose shapes are packed into a neat grid in reading order. Sizes stay.
 */
export function tidy(editor: Editor): number {
  if (editor.locked) return 0;
  const picked = editor.selected();
  const pool: readonly ShapeView[] = picked.length >= 2 ? picked : editor.scene.ordered();
  const movable = pool.filter((s) => s.kind !== "arrow" && s.kind !== "frame" && s.kind !== "comment" && s.kind !== "path");
  if (movable.length < 2) return 0;
  const ids = new Set(movable.map((s) => s.id));
  const edges = editor.scene
    .ordered()
    .filter((s) => s.kind === "arrow" && s.from && s.to && ids.has(s.from) && ids.has(s.to))
    .map((s) => ({ from: s.from ?? "", to: s.to ?? "" }));
  const minX = Math.min(...movable.map((s) => s.x));
  const minY = Math.min(...movable.map((s) => s.y));
  const group = editor.beginGroup();
  const updates: Array<{ id: NodeId; patch: { x: number; y: number } }> = [];
  if (edges.length > 0) {
    const shapeOf = (s: ShapeView): NodeShape => (s.kind === "diamond" ? "decision" : s.kind === "ellipse" ? "start" : "step");
    const nodes: DiagramNode[] = movable.map((s) => ({ id: s.id, shape: shapeOf(s) }));
    const rects = layoutDiagram("flowchart", nodes, edges, { x: minX, y: minY });
    for (const s of movable) {
      const r = rects.get(s.id);
      if (r) updates.push({ id: s.id, patch: { x: r.x + r.w / 2 - s.w / 2, y: r.y + r.h / 2 - s.h / 2 } });
    }
  } else {
    // Reading order (rows, then left to right), then a grid sized to the items.
    const sorted = [...movable].sort((a, b) => Math.round(a.y / 120) - Math.round(b.y / 120) || a.x - b.x);
    const cols = Math.max(1, Math.round(Math.sqrt(sorted.length * 1.6)));
    const cellW = Math.max(...sorted.map((s) => s.w)) + TIDY_GAP;
    const rowHeights: number[] = [];
    sorted.forEach((s, i) => {
      const row = Math.floor(i / cols);
      rowHeights[row] = Math.max(rowHeights[row] ?? 0, s.h);
    });
    sorted.forEach((s, i) => {
      const row = Math.floor(i / cols);
      const y = minY + rowHeights.slice(0, row).reduce((a, b) => a + b + TIDY_GAP, 0);
      updates.push({ id: s.id, patch: { x: minX + (i % cols) * cellW, y } });
    });
  }
  editor.updateShapes(updates, group);
  return updates.length;
}
