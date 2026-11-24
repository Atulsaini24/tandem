import type { ShapeView } from "@canvas/doc";
import type { Editor } from "./editor";

/**
 * Comment threads. The comment's own label is the first message; replies are separate
 * keys on the shape (CanvasDocument.reply), so two people answering at once both land.
 * Resolving is a flag in the comment's `data`.
 */
export interface Reply {
  readonly key: string;
  readonly author: string;
  readonly color: number;
  readonly text: string;
  readonly at: number;
  /** Who wrote it (the identity id), so only they can edit or delete it. */
  readonly by: string;
}

export function repliesOf(view: ShapeView | undefined): Reply[] {
  return (view?.replies ?? []).flatMap(({ key, value }) => {
    try {
      const r = JSON.parse(value) as Partial<{ a: string; c: number; t: string; at: number; by: string }>;
      if (typeof r.t !== "string" || !r.t.trim()) return [];
      return [{ key, author: typeof r.a === "string" ? r.a.slice(0, 40) : "Someone", color: typeof r.c === "number" ? r.c : 0x8a8f98, text: r.t.slice(0, 2000), at: typeof r.at === "number" ? r.at : 0, by: typeof r.by === "string" ? r.by : "" }];
    } catch {
      return [];
    }
  });
}

export function isResolved(view: ShapeView | undefined): boolean {
  if (!view?.data) return false;
  try {
    return (JSON.parse(view.data) as { resolved?: unknown }).resolved === true;
  } catch {
    return false;
  }
}

export function addReply(editor: Editor, id: string, text: string, me: { id: string; name: string; color: number }): void {
  const clean = text.trim().slice(0, 2000);
  if (!clean) return;
  const key = `${Date.now().toString(36)}-${me.id.replace(/[^\w]/g, "").slice(0, 8)}`;
  editor.engine.send({ type: "reply", seq: editor.engine.nextSeq(), id, key, value: JSON.stringify({ a: me.name, c: me.color, t: clean, at: Date.now(), by: me.id }) });
}

export function deleteReply(editor: Editor, id: string, key: string): void {
  editor.engine.send({ type: "reply", seq: editor.engine.nextSeq(), id, key, value: "" });
}

export function setResolved(editor: Editor, id: string, resolved: boolean): void {
  editor.updateShapes([{ id, patch: { data: resolved ? JSON.stringify({ resolved: true }) : "" } }]);
}

/** Everyone who could be @mentioned: people here now, plus anyone who has commented. */
export function mentionable(editor: Editor): string[] {
  const names = new Set<string>();
  for (const p of editor.peers.list()) if (p.presence.name) names.add(p.presence.name);
  for (const s of editor.scene.ordered()) {
    if (s.kind !== "comment") continue;
    if (s.author) names.add(s.author);
    for (const r of repliesOf(s)) names.add(r.author);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** The text split into plain runs and @mentions of known names (longest names win). */
export function splitMentions(text: string, names: readonly string[]): { text: string; mention: boolean }[] {
  const sorted = [...names].filter(Boolean).sort((a, b) => b.length - a.length);
  const out: { text: string; mention: boolean }[] = [];
  let plain = "";
  for (let i = 0; i < text.length; ) {
    // "@" starts a mention only at a word start (not in ana@lee.dev), and the name must
    // end there too (so @Ana doesn't match inside @Anastasia).
    const wordStart = i === 0 || !/[\p{L}\p{N}_]/u.test(text[i - 1] ?? "");
    if (text[i] === "@" && wordStart) {
      const rest = text.slice(i + 1).toLowerCase();
      const hit = sorted.find((n) => rest.startsWith(n.toLowerCase()) && !/[\p{L}\p{N}_]/u.test(rest[n.length] ?? ""));
      if (hit) {
        if (plain) out.push({ text: plain, mention: false });
        plain = "";
        out.push({ text: `@${text.slice(i + 1, i + 1 + hit.length)}`, mention: true });
        i += hit.length + 1;
        continue;
      }
    }
    plain += text[i];
    i += 1;
  }
  if (plain) out.push({ text: plain, mention: false });
  return out;
}

export const mentions = (text: string, name: string): boolean => splitMentions(text, [name]).some((p) => p.mention);

/** Every thread on the board, newest activity first. */
export function threads(editor: Editor): { view: ShapeView; replies: Reply[]; resolved: boolean; last: number }[] {
  return editor.scene
    .ordered()
    .filter((s) => s.kind === "comment" && (s.label ?? "").trim())
    .map((view) => {
      const replies = repliesOf(view);
      return { view, replies, resolved: isResolved(view), last: Math.max(0, ...replies.map((r) => r.at)) };
    })
    .sort((a, b) => b.last - a.last);
}
