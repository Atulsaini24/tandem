import type { ShapeProps } from "@canvas/doc";

/** Building blocks for templates: notes, frames, cards, connectors, designed slides, charts, 3D. */
export interface TemplateShape {
  readonly key: string;
  readonly props: ShapeProps;
}

export const NOTE_COLORS = {
  yellow: 0xffd666,
  pink: 0xffadc8,
  green: 0xa8e6b4,
  blue: 0xa9cdff,
  purple: 0xcdb8ff,
  orange: 0xffc49b,
} as const;

export const INK = 0x111318;
export const FILLS = Object.values(NOTE_COLORS);

export const note = (key: string, x: number, y: number, label: string, fill: number = NOTE_COLORS.yellow, w = 280, h = 84): TemplateShape => ({ key, props: { kind: "rect", x, y, w, h, fill, label } });

export const frame = (key: string, x: number, y: number, w: number, h: number, label: string, fill: number): TemplateShape => ({ key, props: { kind: "frame", x, y, w, h, fill, label } });

export const arrow = (key: string, from: string, to: string, label?: string): TemplateShape => ({
  key,
  props: { kind: "arrow", x: 0, y: 0, w: 1, h: 1, fill: INK, points: "0,0 1,1", from, to, ...(label ? { label } : {}) },
});

export const text = (key: string, x: number, y: number, w: number, h: number, label: string): TemplateShape => ({ key, props: { kind: "text", x, y, w, h, fill: INK, label } });

export const shape = (key: string, kind: "rect" | "ellipse" | "diamond", x: number, y: number, w: number, h: number, label: string, fill: number): TemplateShape => ({ key, props: { kind, x, y, w, h, fill, label } });

/** A task card like the AI's rich plans: title, detail, then owner · due · priority. */
export const card = (key: string, x: number, y: number, w: number, title: string, detail: string, owner: string, due: string, priority: "high" | "medium" | "low", fill: number): TemplateShape => {
  const dot = priority === "high" ? "🔴" : priority === "medium" ? "🟠" : "🟢";
  return note(key, x, y, `${title}\n\n${detail}\n\n👤 ${owner} · 📅 ${due} · ${dot} ${priority}`, fill, w, 168);
};

export const slide = (key: string, x: number, y: number, data: Record<string, unknown>, title: string): TemplateShape[] => [
  frame(`${key}-f`, x, y, 960, 540, title, 0x2f63ff),
  { key, props: { kind: "slide", x, y, w: 960, h: 540, fill: INK, label: title, data: JSON.stringify(data) } },
];

export const chart = (key: string, x: number, y: number, w: number, h: number, data: Record<string, unknown>): TemplateShape => ({
  key,
  props: { kind: "chart", x, y, w, h, fill: 0x2f63ff, label: typeof data.title === "string" ? data.title : "Chart", data: JSON.stringify(data) },
});

export const scene = (key: string, x: number, y: number, w: number, h: number, spec: { title: string }): TemplateShape => ({
  key,
  props: { kind: "scene3d", x, y, w, h, fill: INK, label: spec.title, data: JSON.stringify(spec) },
});

/** A whole deck laid out in a grid of frames (4 per row), numbered and themed. */
export function deck(name: string, theme: string, slides: ReadonlyArray<Record<string, unknown>>, perRow = 4): TemplateShape[] {
  return slides.flatMap((s, i) => slide(`s${i}`, (i % perRow) * 1080, Math.floor(i / perRow) * 680, { ...s, theme, deck: name, index: i, total: slides.length }, `${i + 1}. ${String(s.title).replace(/\*/g, "")}`));
}

/** Labeled columns of sticky notes inside frames. */
export function columns(cols: ReadonlyArray<{ title: string; fill: number; noteFill: number; notes: readonly string[] }>, width = 320): TemplateShape[] {
  const out: TemplateShape[] = [];
  cols.forEach((column, c) => {
    const x = c * (width + 40);
    const height = Math.max(520, 40 + column.notes.length * 104 + 80);
    out.push(frame(`col${c}`, x, 0, width, height, column.title, column.fill));
    column.notes.forEach((t, i) => out.push(note(`n${c}-${i}`, x + 20, 24 + i * 104, t, column.noteFill, width - 40)));
  });
  return out;
}

/** A grid of labeled frames, each holding a few notes (canvases, matrices, maps). */
export function blocks(cells: ReadonlyArray<{ x: number; y: number; w: number; h: number; title: string; fill: number; notes: readonly string[]; noteFill?: number }>): TemplateShape[] {
  return cells.flatMap((c, i) => [
    frame(`b${i}`, c.x, c.y, c.w, c.h, c.title, c.fill),
    ...c.notes.map((t, k) => note(`b${i}n${k}`, c.x + 18, c.y + 22 + k * 92, t, c.noteFill ?? NOTE_COLORS.yellow, c.w - 36, 78)),
  ]);
}

/** A top-down tree: nodes with children, connected by arrows. */
export interface TreeNode {
  readonly label: string;
  readonly fill?: number;
  readonly kind?: "rect" | "ellipse" | "diamond";
  readonly children?: readonly TreeNode[];
}

export function tree(root: TreeNode, nodeW = 220, nodeH = 84, gapX = 40, gapY = 120): TemplateShape[] {
  const out: TemplateShape[] = [];
  let leaf = 0;
  const place = (n: TreeNode, depth: number, key: string): number => {
    let cx: number;
    if (!n.children || n.children.length === 0) {
      cx = leaf * (nodeW + gapX) + nodeW / 2;
      leaf += 1;
    } else {
      const xs = n.children.map((c, i) => place(c, depth + 1, `${key}-${i}`));
      cx = ((xs[0] ?? 0) + (xs[xs.length - 1] ?? 0)) / 2;
      n.children.forEach((_, i) => out.push(arrow(`a${key}-${i}`, key, `${key}-${i}`)));
    }
    out.push(shape(key, n.kind ?? "rect", cx - nodeW / 2, depth * (nodeH + gapY), nodeW, nodeH, n.label, n.fill ?? NOTE_COLORS.blue));
    return cx;
  };
  place(root, 0, "t");
  return out;
}
