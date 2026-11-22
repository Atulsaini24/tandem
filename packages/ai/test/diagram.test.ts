import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DiagramReader, InsightReader, buildInsightMessages, layoutDiagram, type DiagramEvent } from "../src/index.js";

/** Feed text in random-sized chunks, as a network stream would. */
function feed<T>(reader: { push(chunk: string): T[] }, text: string, sizes: readonly number[]): T[] {
  const out: T[] = [];
  let i = 0;
  let k = 0;
  while (i < text.length) {
    const n = Math.max(1, sizes[k++ % Math.max(1, sizes.length)] ?? 7);
    out.push(...reader.push(text.slice(i, i + n)));
    i += n;
  }
  return out;
}

const flow = JSON.stringify({
  title: "Pull request",
  nodes: [
    { id: "Open PR", label: "Open a pull request", shape: "start" },
    { id: "review", label: "Code review", shape: "step" },
    { id: "ok", label: "Approved?", shape: "decision" },
    { id: "merge", label: "Merge", shape: "end" },
    { id: "review", label: "duplicate id", shape: "step" },
    { id: "", label: "no id", shape: "step" },
  ],
  edges: [
    { from: "open-pr", to: "review" },
    { from: "review", to: "ok" },
    { from: "ok", to: "merge", label: "Yes" },
    { from: "ok", to: "review", label: "No" },
    { from: "ok", to: "ok" },
    { from: "ok", to: "ghost" },
    { from: "review", to: "ok" },
  ],
});

describe("diagram reader", () => {
  it("streams valid nodes and edges, whatever the chunking, and drops the rest", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 40 }), { minLength: 1, maxLength: 20 }), (sizes) => {
        const reader = new DiagramReader("flowchart");
        const events = feed<DiagramEvent>(reader, flow, sizes);
        expect(events.filter((e) => e.type === "node").map((e) => (e.type === "node" ? e.id : ""))).toEqual(["open-pr", "review", "ok", "merge"]);
        expect(events.filter((e) => e.type === "edge")).toHaveLength(4);
        expect(events.find((e) => e.type === "edge" && e.to === "merge")).toMatchObject({ label: "Yes" });
        expect(reader.rejected).toBe(5); // dup id, empty id, self-loop, ghost target, dup edge
      }),
      { numRuns: 200 },
    );
  });

  it("resolves edge ends written as labels instead of ids", () => {
    const reader = new DiagramReader("flowchart");
    const events = reader.push(
      JSON.stringify({ title: "x", nodes: [{ id: "n1", label: "Open ticket", shape: "start" }, { id: "n2", label: "Triage", shape: "step" }], edges: [{ from: "Open ticket", to: "n2" }] }),
    );
    expect(events.find((e) => e.type === "edge")).toMatchObject({ from: "n1", to: "n2" });
  });

  it("mind maps stream as a tree: center, branches, ideas, wired automatically", () => {
    const tree = JSON.stringify({ title: "Offsite", center: "Team offsite", branches: [{ label: "Venue", ideas: ["Cabin", "Beach"] }, { label: "Food", ideas: ["BBQ"] }] });
    const reader = new DiagramReader("mindmap");
    const events = feed<DiagramEvent>(reader, tree, [4, 9, 2]);
    const nodes = events.filter((e) => e.type === "node");
    expect(nodes.map((n) => (n.type === "node" ? n.label : ""))).toEqual(["Team offsite", "Venue", "Cabin", "Beach", "Food", "BBQ"]);
    expect(nodes.every((n) => n.type === "node" && n.shape === "topic")).toBe(true);
    expect(events.filter((e) => e.type === "edge")).toHaveLength(5);
    expect(reader.rejected).toBe(0);
  });
});

describe("diagram layout", () => {
  const nodes = [
    { id: "a", shape: "start" as const },
    { id: "b", shape: "step" as const },
    { id: "c", shape: "decision" as const },
    { id: "d", shape: "end" as const },
    { id: "e", shape: "step" as const },
  ];
  const edges = [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "c", to: "d" },
    { from: "c", to: "e" },
    { from: "e", to: "b" }, // a loop back must not break layering
  ];

  it("flowcharts flow left to right in layers without overlaps", () => {
    const rects = layoutDiagram("flowchart", nodes, edges, { x: 0, y: 0 });
    const x = (id: string): number => rects.get(id)?.x ?? NaN;
    expect(x("a")).toBeLessThan(x("b"));
    expect(x("b")).toBeLessThan(x("c"));
    expect(x("c")).toBeLessThan(x("d"));
    expect(Math.abs(x("d") - x("e"))).toBeLessThan(40); // same layer
    const all = [...rects.values()];
    for (const [i, r] of all.entries()) for (const s of all.slice(i + 1)) {
      const overlap = r.x < s.x + s.w && s.x < r.x + r.w && r.y < s.y + s.h && s.y < r.y + r.h;
      expect(overlap).toBe(false);
    }
  });

  it("mind maps place every node, the first one in the middle", () => {
    const rects = layoutDiagram("mindmap", nodes, edges, { x: 0, y: 0 });
    expect(rects.size).toBe(nodes.length);
    const root = rects.get("a");
    const xs = [...rects.values()].map((r) => r.x + r.w / 2);
    expect(root && root.x + root.w / 2).toBeCloseTo((Math.min(...xs) + Math.max(...xs)) / 2, -2);
  });
});

describe("insights", () => {
  it("streams a summary, points and missing items, capped", () => {
    const reader = new InsightReader();
    const json = JSON.stringify({ summary: "A launch plan.", points: Array.from({ length: 9 }, (_, i) => `p${i}`), missing: ["Owners", "  ", "Dates"] });
    const events = feed(reader, json, [5, 3, 11]);
    expect(events[0]).toEqual({ type: "summary", text: "A launch plan." });
    expect(events.filter((e) => e.type === "point")).toHaveLength(6);
    expect(events.filter((e) => e.type === "missing").map((e) => ("text" in e ? e.text : ""))).toEqual(["Owners", "Dates"]);
  });

  it("sends the board's text within a budget", () => {
    const messages = buildInsightMessages("", Array.from({ length: 500 }, (_, i) => `Item number ${i} `.repeat(4)));
    expect(messages[1]?.content.length).toBeLessThan(6_200);
  });
});
