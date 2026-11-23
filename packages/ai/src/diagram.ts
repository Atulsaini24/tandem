import { JsonStreamParser, pathMatches } from "./json-stream.js";
import type { Rect } from "./layout.js";
import { streamChat } from "./ollama.js";
import { LIMITS, cleanText, type ChatMessage } from "./plan.js";
import type { AssistantOptions } from "./assistant.js";

/**
 * Diagrams (flowcharts, mind maps) and board insights (summary, key points, what's
 * missing). Same principles as board plans: the model writes CONTENT and STRUCTURE
 * (nodes, edges), never coordinates; everything it returns is validated; layout is
 * deterministic code.
 */

export type DiagramKind = "flowchart" | "mindmap";
export type NodeShape = "start" | "step" | "decision" | "end" | "topic";
const NODE_SHAPES: readonly NodeShape[] = ["start", "step", "decision", "end", "topic"];

export const DIAGRAM_LIMITS = { nodes: 24, edges: 40, idChars: 24, labelChars: 60, edgeLabelChars: 24 } as const;
export const INSIGHT_LIMITS = { summaryChars: 400, points: 6, missing: 6, itemChars: 90, boardChars: 6_000 } as const;

/** Nodes first, then edges: cards can appear while the connections are still being written. */
export const DIAGRAM_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    nodes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          shape: { type: "string", enum: NODE_SHAPES },
        },
        required: ["id", "label", "shape"],
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        properties: { from: { type: "string" }, to: { type: "string" }, label: { type: "string" } },
        required: ["from", "to"],
      },
    },
  },
  required: ["title", "nodes", "edges"],
} as const;

/**
 * Mind maps are a tree, so ask for a tree. The first eval asked gemma3:4b for nodes +
 * edges and got 3 nodes and 0 usable edges for "ideas for a team offsite": small models
 * lose track of ids. Nested branches → ideas can't be mis-wired.
 */
export const MINDMAP_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    center: { type: "string" },
    branches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          ideas: { type: "array", items: { type: "string" } },
        },
        required: ["label", "ideas"],
      },
    },
  },
  required: ["title", "center", "branches"],
} as const;

export const INSIGHT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    points: { type: "array", items: { type: "string" } },
    missing: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "points", "missing"],
} as const;

const FLOW_SYSTEM = `You draw flowcharts for a whiteboard. Reply ONLY with JSON matching the schema:
- "title": a short title.
- "nodes": 4 to 14 steps. "id" is a short unique slug (like "review"), "label" a short phrase (under 40 characters),
  "shape": "start" for the first step, "end" for final steps, "decision" for yes/no questions, otherwise "step".
- "edges": connections {"from": id, "to": id}. Edges leaving a decision get "label": "Yes" or "No".
Every node must be connected. Use only ids from "nodes".`;

const MINDMAP_SYSTEM = `You draw mind maps for a whiteboard. Reply ONLY with JSON matching the schema:
- "title": a short title.
- "center": the central topic, a short phrase.
- "branches": 4 to 6 main themes. Each has a short "label" and 2 or 3 "ideas" (short phrases, under 40 characters).
No numbering, no markdown.`;

const INSIGHT_SYSTEM = `You review whiteboards. You get the text of every item on a board.
Reply ONLY with JSON matching the schema:
- "summary": 1 to 3 sentences on what the board is about and where it stands.
- "points": up to 5 key takeaways, each a short phrase.
- "missing": up to 5 concrete things the board does not cover yet but should (risks, owners, dates, steps), each a short phrase.
Base everything on the board's content. No markdown.`;

export function buildDiagramMessages(kind: DiagramKind, prompt: string): ChatMessage[] {
  const clean = cleanText(prompt, LIMITS.promptChars) ?? "";
  return [
    { role: "system", content: kind === "flowchart" ? FLOW_SYSTEM : MINDMAP_SYSTEM },
    { role: "user", content: clean || (kind === "flowchart" ? "How a pull request gets merged" : "Ideas for a team offsite") },
  ];
}

/** `items`: the board's text, one entry per shape (frames are written as "Frame: …"). */
export function buildInsightMessages(prompt: string, items: readonly string[]): ChatMessage[] {
  let budget: number = INSIGHT_LIMITS.boardChars;
  const lines: string[] = [];
  for (const item of items) {
    const text = cleanText(item, 200);
    if (!text) continue;
    if (text.length + 3 > budget) break;
    budget -= text.length + 3;
    lines.push(`- ${text}`);
  }
  const ask = cleanText(prompt, 500);
  return [
    { role: "system", content: INSIGHT_SYSTEM },
    { role: "user", content: `${ask ? `Focus: ${ask}\n\n` : ""}Board items:\n${lines.join("\n") || "- (the board is empty)"}` },
  ];
}

export type DiagramEvent =
  | { readonly type: "title"; readonly title: string }
  | { readonly type: "node"; readonly id: string; readonly label: string; readonly shape: NodeShape; readonly index: number }
  | { readonly type: "edge"; readonly from: string; readonly to: string; readonly label?: string }
  | { readonly type: "done"; readonly nodes: number; readonly edges: number; readonly rejected: number; readonly tokensPerSecond?: number };

export type InsightEvent =
  | { readonly type: "summary"; readonly text: string }
  | { readonly type: "point"; readonly text: string; readonly index: number }
  | { readonly type: "missing"; readonly text: string; readonly index: number }
  | { readonly type: "done"; readonly rejected: number; readonly tokensPerSecond?: number };

const slug = (raw: unknown): string | undefined => {
  if (typeof raw !== "string") return undefined;
  const id = raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, DIAGRAM_LIMITS.idChars);
  return id.length > 0 ? id : undefined;
};

/** Validates a streaming diagram: unique ids, real edge ends, no self-loops or duplicates. */
export class DiagramReader {
  readonly #parser = new JsonStreamParser();
  readonly #kind: DiagramKind;
  readonly #ids = new Set<string>();
  /** Slug of each node's label → its id: models often wire edges by label, not id. */
  readonly #byLabel = new Map<string, string>();
  readonly #edges = new Set<string>();
  /** Mind maps: the id of each branch, by its index. */
  readonly #branches = new Map<number, string>();
  #center: string | undefined;
  #titleSent = false;
  nodes = 0;
  edges = 0;
  rejected = 0;

  constructor(kind: DiagramKind) {
    this.#kind = kind;
  }

  push(chunk: string): DiagramEvent[] {
    const events: DiagramEvent[] = [];
    for (const { path, value } of this.#parser.push(chunk)) {
      if (pathMatches(path, ["title"]) && !this.#titleSent) {
        const title = cleanText(value, LIMITS.titleChars);
        if (title) {
          this.#titleSent = true;
          events.push({ type: "title", title });
        }
      } else if (pathMatches(path, ["nodes", "#"])) {
        this.#node(value, events);
      } else if (pathMatches(path, ["edges", "#"])) {
        this.#edge(value, events);
      } else if (this.#kind === "mindmap") {
        this.#tree(path, value, events);
      }
    }
    return events;
  }

  /** Mind map tree: center, branches[i].label, branches[i].ideas[j]. */
  #tree(path: readonly (string | number)[], value: unknown, events: DiagramEvent[]): void {
    if (pathMatches(path, ["center"])) {
      this.#center = this.#node({ id: `center-${cleanText(value, 20) ?? "topic"}`, label: value, shape: "topic" }, events);
    } else if (pathMatches(path, ["branches", "#", "label"])) {
      const index = path[1];
      const id = this.#node({ id: `b${String(index)}-${cleanText(value, 16) ?? ""}`, label: value, shape: "topic" }, events);
      if (id && typeof index === "number") {
        this.#branches.set(index, id);
        if (this.#center) this.#edge({ from: this.#center, to: id }, events);
      }
    } else if (pathMatches(path, ["branches", "#", "ideas", "#"])) {
      const parent = typeof path[1] === "number" ? this.#branches.get(path[1]) : undefined;
      const id = this.#node({ id: `i${String(path[1])}-${String(path[3])}-${cleanText(value, 12) ?? ""}`, label: value, shape: "topic" }, events);
      if (id && parent) this.#edge({ from: parent, to: id }, events);
    }
  }

  /** An edge end: an exact id, or failing that, a node whose label matches. */
  #resolve(raw: unknown): string | undefined {
    const id = slug(raw);
    if (!id) return undefined;
    return this.#ids.has(id) ? id : this.#byLabel.get(id);
  }

  #node(value: unknown, events: DiagramEvent[]): string | undefined {
    const node = typeof value === "object" && value !== null ? (value as { id?: unknown; label?: unknown; shape?: unknown }) : {};
    const id = slug(node.id);
    const label = cleanText(node.label, DIAGRAM_LIMITS.labelChars);
    if (!id || !label || this.#ids.has(id) || this.nodes >= DIAGRAM_LIMITS.nodes) {
      this.rejected += 1;
      return undefined;
    }
    let shape: NodeShape = typeof node.shape === "string" && (NODE_SHAPES as readonly string[]).includes(node.shape) ? (node.shape as NodeShape) : "step";
    if (this.#kind === "mindmap") shape = "topic";
    else if (shape === "topic") shape = "step";
    this.#ids.add(id);
    const byLabel = slug(label);
    if (byLabel && !this.#byLabel.has(byLabel)) this.#byLabel.set(byLabel, id);
    events.push({ type: "node", id, label, shape, index: this.nodes++ });
    return id;
  }

  #edge(value: unknown, events: DiagramEvent[]): void {
    const edge = typeof value === "object" && value !== null ? (value as { from?: unknown; to?: unknown; label?: unknown }) : {};
    const from = this.#resolve(edge.from);
    const to = this.#resolve(edge.to);
    const key = `${from}>${to}`;
    if (!from || !to || from === to || this.#edges.has(key) || this.edges >= DIAGRAM_LIMITS.edges) {
      this.rejected += 1;
      return;
    }
    this.#edges.add(key);
    this.edges += 1;
    const label = cleanText(edge.label, DIAGRAM_LIMITS.edgeLabelChars);
    events.push(label ? { type: "edge", from, to, label } : { type: "edge", from, to });
  }
}

export class InsightReader {
  readonly #parser = new JsonStreamParser();
  #summarySent = false;
  points = 0;
  missing = 0;
  rejected = 0;

  push(chunk: string): InsightEvent[] {
    const events: InsightEvent[] = [];
    for (const { path, value } of this.#parser.push(chunk)) {
      if (pathMatches(path, ["summary"]) && !this.#summarySent) {
        const text = cleanText(value, INSIGHT_LIMITS.summaryChars);
        if (text) {
          this.#summarySent = true;
          events.push({ type: "summary", text });
        } else this.rejected += 1;
      } else if (pathMatches(path, ["points", "#"])) {
        const text = cleanText(value, INSIGHT_LIMITS.itemChars);
        if (text && this.points < INSIGHT_LIMITS.points) events.push({ type: "point", text, index: this.points++ });
        else this.rejected += 1;
      } else if (pathMatches(path, ["missing", "#"])) {
        const text = cleanText(value, INSIGHT_LIMITS.itemChars);
        if (text && this.missing < INSIGHT_LIMITS.missing) events.push({ type: "missing", text, index: this.missing++ });
        else this.rejected += 1;
      }
    }
    return events;
  }
}

// --- layout ----------------------------------------------------------------------------

export interface DiagramNode {
  readonly id: string;
  readonly shape: NodeShape;
}

export interface DiagramEdge {
  readonly from: string;
  readonly to: string;
}

export const NODE_SIZE: Readonly<Record<NodeShape, { w: number; h: number }>> = {
  start: { w: 210, h: 96 },
  end: { w: 210, h: 96 },
  step: { w: 230, h: 92 },
  decision: { w: 210, h: 150 },
  topic: { w: 220, h: 84 },
};

/** Where a node goes while the diagram is still streaming (a loose grid, before edges exist). */
export function stagingRect(origin: { x: number; y: number }, index: number, shape: NodeShape): Rect {
  const size = NODE_SIZE[shape];
  const col = index % 4;
  const row = Math.floor(index / 4);
  return { x: origin.x + col * 280, y: origin.y + row * 190, ...size };
}

/** BFS depth from the roots (nodes nothing points to; else the first node). Back edges are ignored. */
function ranks(nodes: readonly DiagramNode[], edges: readonly DiagramEdge[]): Map<string, number> {
  const out = new Map<string, string[]>();
  const indegree = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) {
    out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
  }
  const roots = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  const first = nodes[0]?.id;
  const queue = roots.length > 0 ? roots : first ? [first] : [];
  const rank = new Map<string, number>(queue.map((id) => [id, 0]));
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (id === undefined) continue;
    for (const next of out.get(id) ?? []) {
      if (rank.has(next)) continue;
      rank.set(next, (rank.get(id) ?? 0) + 1);
      queue.push(next);
    }
  }
  // Anything unreachable joins the first column.
  for (const n of nodes) if (!rank.has(n.id)) rank.set(n.id, 0);
  return rank;
}

/**
 * Arrow crossings between adjacent layers: edges (a→b), (c→d) cross when their ends are
 * in opposite order. The number the layout tries to keep small.
 */
export function countCrossings(layers: ReadonlyMap<number, readonly DiagramNode[]>, edges: readonly DiagramEdge[]): number {
  const where = new Map<string, { rank: number; index: number }>();
  for (const [rank, layer] of layers) layer.forEach((n, index) => where.set(n.id, { rank, index }));
  const spans = edges.flatMap((e) => {
    const a = where.get(e.from);
    const b = where.get(e.to);
    if (!a || !b || Math.abs(a.rank - b.rank) !== 1) return [];
    return a.rank < b.rank ? [{ rank: a.rank, top: a.index, bottom: b.index }] : [{ rank: b.rank, top: b.index, bottom: a.index }];
  });
  let crossings = 0;
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const p = spans[i];
      const q = spans[j];
      if (p && q && p.rank === q.rank && (p.top - q.top) * (p.bottom - q.bottom) < 0) crossings += 1;
    }
  }
  return crossings;
}

/**
 * Reorder each layer so connected nodes line up (the barycenter heuristic): sweep down
 * and up a few times, sorting every layer by the average position of its neighbours in
 * the layer before. Keeps the best ordering seen, so it never makes things worse.
 */
export function orderLayers(layers: Map<number, DiagramNode[]>, edges: readonly DiagramEdge[]): void {
  const ranks = [...layers.keys()].sort((a, b) => a - b);
  const neighbours = new Map<string, string[]>();
  for (const e of edges) {
    neighbours.set(e.from, [...(neighbours.get(e.from) ?? []), e.to]);
    neighbours.set(e.to, [...(neighbours.get(e.to) ?? []), e.from]);
  }
  const snapshot = (): Map<number, DiagramNode[]> => new Map([...layers].map(([r, l]) => [r, [...l]]));
  let best = snapshot();
  let bestCrossings = countCrossings(layers, edges);
  const sortBy = (rank: number, against: number): void => {
    const layer = layers.get(rank);
    const ref = layers.get(against);
    if (!layer || !ref) return;
    const index = new Map(ref.map((n, i) => [n.id, i]));
    const keyed = layer.map((n, i) => {
      const pos = (neighbours.get(n.id) ?? []).flatMap((m) => (index.has(m) ? [index.get(m) ?? 0] : []));
      return { n, key: pos.length > 0 ? pos.reduce((a, b) => a + b, 0) / pos.length : i };
    });
    keyed.sort((a, b) => a.key - b.key);
    layers.set(rank, keyed.map((k) => k.n));
  };
  for (let sweep = 0; sweep < 6 && bestCrossings > 0; sweep++) {
    if (sweep % 2 === 0) for (let i = 1; i < ranks.length; i++) sortBy(ranks[i] ?? 0, ranks[i - 1] ?? 0);
    else for (let i = ranks.length - 2; i >= 0; i--) sortBy(ranks[i] ?? 0, ranks[i + 1] ?? 0);
    const crossings = countCrossings(layers, edges);
    if (crossings < bestCrossings) {
      bestCrossings = crossings;
      best = snapshot();
    }
  }
  layers.clear();
  for (const [r, l] of best) layers.set(r, l);
}

/**
 * Final positions. Flowcharts flow left to right in layers (each layer centered
 * vertically); mind maps radiate from the first node, each branch keeping its own sector.
 */
export function layoutDiagram(kind: DiagramKind, nodes: readonly DiagramNode[], edges: readonly DiagramEdge[], origin: { x: number; y: number }): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  if (nodes.length === 0) return rects;
  if (kind === "flowchart") {
    const rank = ranks(nodes, edges);
    const layers = new Map<number, DiagramNode[]>();
    for (const n of nodes) {
      const r = rank.get(n.id) ?? 0;
      layers.set(r, [...(layers.get(r) ?? []), n]);
    }
    orderLayers(layers, edges);
    const gapX = 110;
    const gapY = 60;
    const tallest = Math.max(...[...layers.values()].map((layer) => layer.reduce((h, n) => h + NODE_SIZE[n.shape].h, 0) + (layer.length - 1) * gapY));
    let x = origin.x;
    for (const r of [...layers.keys()].sort((a, b) => a - b)) {
      const layer = layers.get(r) ?? [];
      const width = Math.max(...layer.map((n) => NODE_SIZE[n.shape].w));
      const height = layer.reduce((h, n) => h + NODE_SIZE[n.shape].h, 0) + (layer.length - 1) * gapY;
      let y = origin.y + (tallest - height) / 2;
      for (const n of layer) {
        const size = NODE_SIZE[n.shape];
        rects.set(n.id, { x: x + (width - size.w) / 2, y, ...size });
        y += size.h + gapY;
      }
      x += width + gapX;
    }
    return rects;
  }

  // Mind map: a tree from the first node.
  const root = nodes[0];
  if (!root) return rects;
  const children = new Map<string, string[]>();
  const seen = new Set([root.id]);
  const queue = [root.id];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (id === undefined) continue;
    for (const e of edges) {
      const next = e.from === id ? e.to : e.to === id ? e.from : undefined;
      if (next === undefined || seen.has(next)) continue;
      seen.add(next);
      children.set(id, [...(children.get(id) ?? []), next]);
      queue.push(next);
    }
  }
  // Orphans hang off the root so nothing is lost.
  for (const n of nodes) if (!seen.has(n.id)) children.set(root.id, [...(children.get(root.id) ?? []), n.id]);

  const center = { x: origin.x + 700, y: origin.y + 500 };
  const rootSize = { w: 260, h: 120 };
  rects.set(root.id, { x: center.x - rootSize.w / 2, y: center.y - rootSize.h / 2, ...rootSize });
  const branches = children.get(root.id) ?? [];
  const leaves = (id: string): number => Math.max(1, (children.get(id) ?? []).length);
  const total = branches.reduce((sum, id) => sum + leaves(id), 0);
  let angle = -Math.PI / 2 - (Math.PI * leaves(branches[0] ?? "")) / Math.max(1, total);
  const size = NODE_SIZE.topic;
  for (const branch of branches) {
    const share = (Math.PI * 2 * leaves(branch)) / Math.max(1, total);
    const mid = angle + share / 2;
    const r1 = 250;
    rects.set(branch, { x: center.x + Math.cos(mid) * r1 * 1.25 - size.w / 2, y: center.y + Math.sin(mid) * r1 - size.h / 2, ...size });
    const kids = children.get(branch) ?? [];
    kids.forEach((kid, k) => {
      const a = angle + (share * (k + 0.5)) / kids.length;
      const r2 = 470;
      rects.set(kid, { x: center.x + Math.cos(a) * r2 * 1.25 - size.w / 2, y: center.y + Math.sin(a) * r2 - size.h / 2, ...size });
      // Deeper levels (rare) stack under their parent.
      (children.get(kid) ?? []).forEach((deep, d) => {
        const p = rects.get(kid);
        if (p) rects.set(deep, { x: p.x, y: p.y + (d + 1) * (size.h + 20), ...size });
      });
    });
    angle += share;
  }
  return rects;
}

// --- runners ------------------------------------------------------------------------------

export async function* runDiagram(kind: DiagramKind, prompt: string, options: AssistantOptions): AsyncGenerator<DiagramEvent> {
  const reader = new DiagramReader(kind);
  let tps: number | undefined;
  for await (const chunk of streamChat({ ...options, messages: buildDiagramMessages(kind, prompt), format: kind === "mindmap" ? MINDMAP_SCHEMA : DIAGRAM_SCHEMA })) {
    yield* reader.push(chunk.content);
    if (chunk.done && chunk.evalCount && chunk.evalSeconds) tps = Math.round((chunk.evalCount / chunk.evalSeconds) * 10) / 10;
  }
  yield { type: "done", nodes: reader.nodes, edges: reader.edges, rejected: reader.rejected, ...(tps === undefined ? {} : { tokensPerSecond: tps }) };
}

export async function* runInsight(prompt: string, items: readonly string[], options: AssistantOptions): AsyncGenerator<InsightEvent> {
  const reader = new InsightReader();
  let tps: number | undefined;
  for await (const chunk of streamChat({ ...options, messages: buildInsightMessages(prompt, items), format: INSIGHT_SCHEMA })) {
    yield* reader.push(chunk.content);
    if (chunk.done && chunk.evalCount && chunk.evalSeconds) tps = Math.round((chunk.evalCount / chunk.evalSeconds) * 10) / 10;
  }
  yield { type: "done", rejected: reader.rejected, ...(tps === undefined ? {} : { tokensPerSecond: tps }) };
}
