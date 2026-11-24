import type { NodeId, ShapeProps, ShapeView } from "@canvas/doc";
import { newBoardId, upsertBoard } from "../boards";
import { navigate } from "../router";
import { useUiStore } from "../state/ui-store";
import type { Editor } from "./editor";

/**
 * Branches, like Git for a board. "Branch" makes a private copy that remembers what the
 * original looked like at that moment (the base). Edit freely; "Merge" works out what the
 * branch changed relative to the base — shapes added, removed, and each property changed —
 * and applies only that to the original, so edits others made there meanwhile survive
 * (same-property conflicts: the branch wins). Works offline: the hand-off is local.
 */
export interface BranchRecord {
  readonly parent: string;
  readonly parentTitle: string;
  readonly base: readonly ShapeView[];
  readonly at: number;
  readonly seeded?: boolean;
}

export interface MergeOps {
  readonly added: readonly ShapeView[];
  readonly changed: ReadonlyArray<{ readonly id: NodeId; readonly patch: Record<string, unknown> }>;
  readonly removed: readonly NodeId[];
}

const branchKey = (id: string): string => `canvas:branch:${id}`;
const mergeKey = (id: string): string => `canvas:merge:${id}`;

function read<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}
function write(key: string, value: unknown): void {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    useUiStore.getState().setNotice("Couldn't save the branch (browser storage is full or blocked).");
  }
}

export const branchOf = (docId: string): BranchRecord | undefined => read<BranchRecord>(branchKey(docId));

/** The props a shape is made of (no id; votes are per-person state, not copied). */
export function propsOf(view: ShapeView): ShapeProps {
  const { id: _id, voters: _voters, ...props } = view;
  void _id;
  void _voters;
  return props as ShapeProps;
}

/** Start a branch of this board and open it. */
export function branchBoard(editor: Editor): string {
  const id = newBoardId();
  const title = useUiStore.getState().title || "Untitled board";
  write(branchKey(id), { parent: editor.docId, parentTitle: title, base: editor.scene.ordered(), at: Date.now() } satisfies BranchRecord);
  upsertBoard(id, { title: `${title} · branch` });
  navigate(`/b/${id}`);
  return id;
}

/** A new branch board starts as an exact copy (same shape ids, so changes can be diffed). */
export function seedBranch(editor: Editor): boolean {
  const record = branchOf(editor.docId);
  if (!record || record.seeded || editor.scene.size > 0) return false;
  editor.createWithIds(record.base.map((s) => ({ id: s.id, props: propsOf(s) })), editor.beginGroup());
  editor.setTitle(`${record.parentTitle} · branch`);
  write(branchKey(editor.docId), { ...record, seeded: true });
  setTimeout(() => editor.zoomToFit(1), 50);
  useUiStore.getState().setNotice(`🌿 Branched from “${record.parentTitle}”. Try anything — merge back when you like it.`);
  return true;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const emptyOf = (v: unknown): unknown => (typeof v === "string" ? "" : typeof v === "number" ? 0 : undefined);

/** What the branch did, relative to its base. */
export function diffBranch(base: readonly ShapeView[], now: readonly ShapeView[]): MergeOps {
  const before = new Map(base.map((s) => [s.id, s]));
  const after = new Map(now.map((s) => [s.id, s]));
  const added = now.filter((s) => !before.has(s.id));
  const removed = base.filter((s) => !after.has(s.id)).map((s) => s.id);
  const changed: Array<{ id: NodeId; patch: Record<string, unknown> }> = [];
  for (const s of now) {
    const old = before.get(s.id);
    if (!old) continue;
    const a = propsOf(old) as unknown as Record<string, unknown>;
    const b = propsOf(s) as unknown as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (key === "kind" || same(a[key], b[key])) continue;
      const value = b[key] === undefined ? emptyOf(a[key]) : b[key];
      if (value !== undefined) patch[key] = value;
    }
    if (Object.keys(patch).length > 0) changed.push({ id: s.id, patch });
  }
  return { added, changed, removed };
}

/** Merge this branch into the board it came from (and go there). */
export function mergeBranch(editor: Editor): MergeOps | undefined {
  const record = branchOf(editor.docId);
  if (!record) return undefined;
  const ops = diffBranch(record.base, editor.scene.ordered());
  write(mergeKey(record.parent), { ops, from: editor.docId, title: useUiStore.getState().title });
  // The branch's new base is what we just merged, so a second merge only sends what's new.
  write(branchKey(editor.docId), { ...record, base: editor.scene.ordered() });
  navigate(`/b/${record.parent}`);
  return ops;
}

/** On opening a board: apply a merge that a branch handed over. */
export function applyPendingMerge(editor: Editor): boolean {
  const pending = read<{ ops: MergeOps; from: string; title: string }>(mergeKey(editor.docId));
  if (!pending) return false;
  write(mergeKey(editor.docId), undefined);
  const { added, changed, removed } = pending.ops;
  const group = editor.beginGroup();
  const fresh = added.filter((s) => !editor.scene.get(s.id));
  if (fresh.length > 0) editor.createWithIds(fresh.map((s) => ({ id: s.id, props: propsOf(s) })), group);
  const updates = changed.filter((c) => editor.scene.get(c.id)).map((c) => ({ id: c.id, patch: c.patch as Partial<ShapeProps> }));
  if (updates.length > 0) editor.updateShapes(updates, group);
  const gone = removed.filter((id) => editor.scene.get(id));
  if (gone.length > 0) editor.deleteShapes(gone);
  useUiStore.getState().setNotice(`🌿 Merged “${pending.title}”: ${fresh.length} added · ${updates.length} changed · ${gone.length} removed`);
  return true;
}

/** Forget a branch (the board itself stays in your list). */
export function discardBranch(editor: Editor): void {
  const record = branchOf(editor.docId);
  write(branchKey(editor.docId), undefined);
  if (record) navigate(`/b/${record.parent}`);
}
