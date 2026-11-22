import type { ReplicaId } from "./types.js";

/**
 * Collaborative plain text using Fugue.
 *
 * Algorithm: Weidner & Kleppmann — "The Art of the Fugue: Minimizing Interleaving
 * in Collaborative Text Editing" (2023).
 *
 * Every character is a node in a tree. Each node has LEFT children and RIGHT
 * children. The text is an in-order walk: left children, the node, right children.
 * Same-side siblings are ordered by id.
 *
 * Inserting a character at visible index i:
 *   leftOrigin = the visible character just before the cursor (or the root).
 *   - If leftOrigin has no right children → new node is its RIGHT child.
 *   - Otherwise → new node is the LEFT child of the next node after leftOrigin in
 *     the walk (deleted or not). That node never already has left children.
 *
 * Why it doesn't interleave: a run of typing builds its own chain (forward typing
 * → a chain of right children, backward typing → a chain of left children). Two
 * people typing at the same spot create two sibling SUBTREES, and an in-order walk
 * emits a whole subtree before moving on to its sibling. So each run stays
 * contiguous — "hello" + "world" can become "helloworld" or "worldhello", never
 * "hweolrllod".
 *
 * As a delta-state CRDT: state = (set of inserted nodes, set of deleted ids).
 * Both are grow-only sets, merge is union, and the visible text is a pure function
 * of the state. A node whose parent hasn't arrived yet waits in a pending buffer.
 */

export interface CharId {
  readonly replica: ReplicaId;
  readonly counter: number;
}

export interface TextInsert {
  readonly id: CharId;
  /** Exactly one Unicode code point. */
  readonly value: string;
  /** null = the root. */
  readonly parent: CharId | null;
  readonly side: "left" | "right";
}

export interface TextDelta {
  readonly inserts: readonly TextInsert[];
  readonly deletes: readonly CharId[];
}

interface CharNode {
  readonly data: TextInsert | null; // null only for the root
  readonly left: string[]; // child keys, sorted by id
  readonly right: string[];
}

const ROOT_KEY = "";

function keyOf(id: CharId): string {
  return `${id.replica}:${id.counter}`;
}

function compareIds(a: CharId, b: CharId): number {
  if (a.replica !== b.replica) return a.replica < b.replica ? -1 : 1;
  return a.counter - b.counter;
}

function first(items: readonly string[]): string | undefined {
  return items[0];
}

export class FugueText {
  readonly replica: ReplicaId;
  #counter = 0;
  readonly #nodes = new Map<string, CharNode>([[ROOT_KEY, { data: null, left: [], right: [] }]]);
  /** Inserts whose parent hasn't arrived yet, keyed by the missing parent. */
  readonly #pending = new Map<string, TextInsert[]>();
  readonly #pendingKeys = new Set<string>();
  readonly #deleted = new Map<string, CharId>();
  /** Cached keys of visible characters in document order. */
  #visible: string[] | undefined;

  constructor(replica: ReplicaId, state?: TextDelta) {
    this.replica = replica;
    if (state) this.merge(state);
  }

  /** Full CRDT state: every insert (attached or pending) and every delete. */
  get state(): TextDelta {
    const inserts: TextInsert[] = [];
    for (const node of this.#nodes.values()) if (node.data) inserts.push(node.data);
    for (const waiting of this.#pending.values()) inserts.push(...waiting);
    return { inserts, deletes: [...this.#deleted.values()] };
  }

  get length(): number {
    return this.#visibleKeys().length;
  }

  toString(): string {
    return this.#visibleKeys()
      .map((key) => this.#node(key).data?.value ?? "")
      .join("");
  }

  /** Insert `text` so that it starts at visible index `index`. */
  insert(index: number, text: string): TextDelta {
    this.#assertRange(index, 0, this.length, "index");
    const chars = Array.from(text); // split by code point, so emoji stay whole
    const inserts: TextInsert[] = [];
    let leftKey = index === 0 ? ROOT_KEY : this.#visibleAt(index - 1);

    for (const value of chars) {
      const leftOrigin = this.#node(leftKey);
      let parentKey: string;
      let side: "left" | "right";
      const firstRight = first(leftOrigin.right);
      if (firstRight === undefined) {
        parentKey = leftKey;
        side = "right";
      } else {
        // The next node after leftOrigin in the walk: the leftmost node of its right subtree.
        parentKey = firstRight;
        for (let next = first(this.#node(parentKey).left); next !== undefined; next = first(this.#node(parentKey).left)) {
          parentKey = next;
        }
        side = "left";
      }

      this.#counter += 1;
      const op: TextInsert = {
        id: { replica: this.replica, counter: this.#counter },
        value,
        parent: this.#node(parentKey).data?.id ?? null,
        side,
      };
      this.#integrate(op);
      inserts.push(op);
      // The next character goes right after this one. It has no right children
      // yet, so a typed run becomes a single chain of right children.
      leftKey = keyOf(op.id);
    }
    return { inserts, deletes: [] };
  }

  /** Delete `count` visible characters starting at `index`. */
  delete(index: number, count = 1): TextDelta {
    this.#assertRange(index, 0, this.length, "index");
    this.#assertRange(count, 0, this.length - index, "count");
    const deletes = this.#visibleKeys()
      .slice(index, index + count)
      .map((key) => {
        const data = this.#node(key).data;
        if (!data) throw new Error("root is never visible");
        return data.id;
      });
    const delta: TextDelta = { inserts: [], deletes };
    this.merge(delta);
    return delta;
  }

  merge(delta: TextDelta): void {
    for (const op of delta.inserts) this.#integrate(op);
    for (const id of delta.deletes) {
      const key = keyOf(id);
      if (!this.#deleted.has(key)) {
        // Recorded even if the insert hasn't arrived yet: a delete can overtake its insert.
        this.#deleted.set(key, id);
        this.#visible = undefined;
      }
    }
  }

  #integrate(op: TextInsert): void {
    const key = keyOf(op.id);
    if (this.#nodes.has(key) || this.#pendingKeys.has(key)) return; // duplicate
    if (op.id.replica === this.replica) this.#counter = Math.max(this.#counter, op.id.counter);

    const parentKey = op.parent ? keyOf(op.parent) : ROOT_KEY;
    if (!this.#nodes.has(parentKey)) {
      const waiting = this.#pending.get(parentKey) ?? [];
      waiting.push(op);
      this.#pending.set(parentKey, waiting);
      this.#pendingKeys.add(key);
      return;
    }

    // Attach it, then anything that was waiting for it (and so on, transitively).
    const queue: TextInsert[] = [op];
    for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
      this.#attach(next);
      const nextKey = keyOf(next.id);
      const waiting = this.#pending.get(nextKey);
      if (waiting) {
        this.#pending.delete(nextKey);
        for (const child of waiting) {
          this.#pendingKeys.delete(keyOf(child.id));
          queue.push(child);
        }
      }
    }
    this.#visible = undefined;
  }

  #attach(op: TextInsert): void {
    const key = keyOf(op.id);
    const parent = this.#node(op.parent ? keyOf(op.parent) : ROOT_KEY);
    this.#nodes.set(key, { data: op, left: [], right: [] });
    const siblings = op.side === "left" ? parent.left : parent.right;
    let i = siblings.length;
    while (i > 0) {
      const before = this.#node(siblings[i - 1] ?? ROOT_KEY).data;
      if (!before || compareIds(before.id, op.id) < 0) break;
      i--;
    }
    siblings.splice(i, 0, key);
  }

  /** In-order walk (left subtree, node, right subtree), iterative to survive long documents. */
  #visibleKeys(): string[] {
    if (this.#visible) return this.#visible;
    const out: string[] = [];
    const stack: Array<{ key: string; emit: boolean }> = [{ key: ROOT_KEY, emit: false }];
    for (let top = stack.pop(); top !== undefined; top = stack.pop()) {
      if (top.emit) {
        if (top.key !== ROOT_KEY && !this.#deleted.has(top.key)) out.push(top.key);
        continue;
      }
      const node = this.#node(top.key);
      for (let i = node.right.length - 1; i >= 0; i--) stack.push({ key: node.right[i] ?? ROOT_KEY, emit: false });
      stack.push({ key: top.key, emit: true });
      for (let i = node.left.length - 1; i >= 0; i--) stack.push({ key: node.left[i] ?? ROOT_KEY, emit: false });
    }
    this.#visible = out;
    return out;
  }

  #visibleAt(index: number): string {
    const key = this.#visibleKeys()[index];
    if (key === undefined) throw new RangeError(`no character at index ${index}`);
    return key;
  }

  #node(key: string): CharNode {
    const node = this.#nodes.get(key);
    if (!node) throw new Error(`unknown character ${key}`);
    return node;
  }

  #assertRange(value: number, min: number, max: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new RangeError(`${name} must be an integer in [${min}, ${max}], got ${value}`);
    }
  }
}
