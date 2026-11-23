import { describe, expect, it } from "vitest";
import { CHART_THEMES, CHART_TYPES, chartSvg, parseChart } from "./charts";
import { autoKpis, parseTable } from "./chart-data";
import { parseSlide, SLIDE_THEMES, slideSvg, type SlideSpec } from "./slides";
import { TEMPLATES } from "./templates";

const svg0 = (spec: SlideSpec | undefined): string => (spec ? slideSvg(spec, 960, 540) : "");
import { parseScene, sceneRadius } from "./scenes";

describe("chart specs (untrusted input)", () => {
  it("accepts a good spec and draws it as SVG", () => {
    const spec = parseChart(JSON.stringify({ type: "bar", title: "Revenue", unit: "$", labels: ["Q1", "Q2"], series: [{ name: "2025", values: [10, 20] }] }));
    expect(spec).toMatchObject({ type: "bar", unit: "$", labels: ["Q1", "Q2"] });
    if (!spec) throw new Error("expected a spec");
    const svg = chartSvg(spec, 600, 400, CHART_THEMES.light);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("Revenue");
  });

  it("repairs or rejects bad input", () => {
    expect(parseChart("not json")).toBeUndefined();
    expect(parseChart(JSON.stringify({ type: "bar", labels: ["a"], series: [] }))).toBeUndefined();
    const repaired = parseChart(JSON.stringify({ type: "hologram", labels: [], series: [{ name: "s", values: [1, "2", "x", null] }] }));
    expect(repaired?.type).toBe("bar");
    expect(repaired?.series[0]?.values).toEqual([1, 2, 0, 0]);
    expect(repaired?.labels).toEqual(["#1", "#2", "#3", "#4"]);
  });

  it("moves a long unit into the note so numbers stay short", () => {
    const spec = parseChart(JSON.stringify({ type: "bar", unit: "Users Active (%)", note: "Estimates", labels: ["a"], series: [{ name: "s", values: [1] }] }));
    expect(spec?.unit).toBe("");
    expect(spec?.note).toBe("Users Active (%) · Estimates");
  });
});

describe("3D scene specs (untrusted input)", () => {
  it("clamps sizes and defaults unknown values", () => {
    const spec = parseScene(JSON.stringify({ backdrop: "moon", objects: [{ shape: "dodecahedron", color: "blue", position: [1e9, 0, "x"], size: [-5, 2, 2], material: "lava" }] }));
    const o = spec?.objects.find((x) => x.shape !== "plane");
    expect(spec?.backdrop).toBe("studio");
    expect(o?.shape).toBe("box");
    expect(o?.color).toBe("#3d7bff");
    expect(o?.material).toBe("matte");
    expect(o?.size[0]).toBe(0.05);
  });

  it("keeps light sources still: a glowing object never orbits", () => {
    const spec = parseScene(JSON.stringify({ backdrop: "space", objects: [{ shape: "planet", glow: true, motion: "orbit", position: [0, 0, 0], size: [2, 2, 2] }, { shape: "planet", motion: "orbit", orbitRadius: 5, position: [5, 0, 0], size: [1, 1, 1] }] }));
    expect(spec?.objects.map((o) => o.motion)).toEqual(["spin", "orbit"]);
    if (!spec) throw new Error("expected a spec");
    expect(sceneRadius(spec)).toBeGreaterThanOrEqual(5);
    expect(parseScene(JSON.stringify({ objects: [] }))).toBeUndefined();
  });

  it("composes a messy scene: scaled, grounded, apart, with a floor", () => {
    // What a small model really wrote: three 30 m towers on one spot, a car inside them.
    const spec = parseScene(
      JSON.stringify({
        backdrop: "night",
        objects: [
          { shape: "building", position: [0, 10, 0], size: [12, 30, 12], motion: "none" },
          { shape: "building", position: [0, 10, 0], size: [10, 25, 10], motion: "none" },
          { shape: "building", position: [0, 10, 0], size: [12, 20, 12], motion: "none" },
          { shape: "car", position: [0, 0, 0], size: [3, 1.5, 1.5], motion: "orbit" },
          { shape: "cloud", position: [0, 1, 0], size: [10, 0.5, 10], motion: "none" },
        ],
      }),
    );
    if (!spec) throw new Error("expected a spec");
    const towers = spec.objects.filter((o) => o.shape === "building");
    expect(Math.max(...towers.map((o) => o.size[1]))).toBeLessThanOrEqual(6.01);
    for (const t of towers) expect(t.position[1]).toBeCloseTo(t.size[1] / 2, 5);
    for (let i = 0; i < towers.length; i += 1)
      for (let j = i + 1; j < towers.length; j += 1) {
        const a = towers[i];
        const b = towers[j];
        if (!a || !b) continue;
        expect(Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2])).toBeGreaterThan(Math.max(a.size[0], b.size[0]) * 0.9);
      }
    const car = spec.objects.find((o) => o.shape === "car");
    const cloud = spec.objects.find((o) => o.shape === "cloud");
    expect(car?.orbitRadius).toBeGreaterThan(2);
    expect(cloud?.position[1]).toBeGreaterThan(Math.max(...towers.map((o) => o.size[1])));
    expect(spec.objects.some((o) => o.shape === "plane")).toBe(true);
  });
});

/** Every design must be well-formed XML: a repeated attribute makes the browser drop the whole image. */
function assertWellFormed(svg: string): void {
  for (const tag of svg.match(/<[a-zA-Z][^>]*>/g) ?? []) {
    const names = [...tag.matchAll(/\s([a-zA-Z_:][-a-zA-Z0-9_:.]*)=/g)].map((m) => m[1]);
    expect(new Set(names).size, tag.slice(0, 120)).toBe(names.length);
  }
  const opens = (svg.match(/<(g|svg|text|defs|clipPath|linearGradient|radialGradient|pattern)[\s>]/g) ?? []).length;
  const closes = (svg.match(/<\/(g|svg|text|defs|clipPath|linearGradient|radialGradient|pattern)>/g) ?? []).length;
  expect(opens).toBe(closes);
}

describe("designed slides and charts", () => {
  const items = [
    { icon: "📉", title: "Stock-outs", text: "14% of sales lost" },
    { icon: "🗑️", title: "Waste", text: "₹3,800 a month" },
    { icon: "", title: "Paper", text: "92% use registers" },
  ];
  const layouts: Array<Record<string, unknown>> = [
    { layout: "title", title: "A <bold> & \"quoted\" title", subtitle: "Sub" },
    { layout: "agenda", title: "Agenda", items },
    { layout: "cards", title: "Problem", items },
    { layout: "stats", title: "Market", stats: [{ value: "63M", label: "stores", delta: "+4%" }, { value: "₹74L Cr", label: "spend", delta: "-1%" }] },
    { layout: "chart", title: "Traction", subtitle: "6x", chart: { type: "area", labels: ["a", "b", "c"], series: [{ name: "x", values: [1, 2, 3] }] } },
    { layout: "timeline", title: "Roadmap", items },
    { layout: "compare", title: "Why", columns: [{ title: "Old", items: ["slow"] }, { title: "New", items: ["fast"] }] },
    { layout: "quote", title: "Say", quote: { text: "Great", author: "Ana" } },
    { layout: "closing", title: "Ask", items },
    { layout: "statement", title: "Great ideas deserve *great tools* & <care>" },
    { layout: "team", title: "Team", items: items.map((i) => ({ ...i, value: "CEO" })) },
    { layout: "pricing", title: "Plans", items: items.map((i) => ({ ...i, value: "₹299/mo", text: "One; Two; Three" })) },
    { layout: "process", title: "Steps", items },
    { layout: "matrix", title: "Focus", axes: ["Effort", "Impact"], items: [...items, { icon: "", title: "Four", text: "x" }] },
    { layout: "stats", title: "Hero", stats: [{ value: "98%", label: "uptime", delta: "+1%" }] },
    { layout: "cards", title: "Pending", items, pending: true },
  ];

  it("draws every layout in every theme as well-formed SVG, escaping text", () => {
    for (const theme of SLIDE_THEMES) {
      for (const l of layouts) {
        const spec = parseSlide(JSON.stringify({ ...l, theme, deck: "Deck", index: 1, total: 9 }));
        expect(spec?.layout).toBe(l.layout);
        expect(svg0(spec)).not.toContain("*great");
        if (!spec) continue;
        const svg = slideSvg(spec, 960, 540);
        assertWellFormed(svg);
        expect(svg).not.toContain("<bold>");
      }
    }
  });

  it("falls back to a layout that has content", () => {
    expect(parseSlide(JSON.stringify({ layout: "chart", title: "No data", items }))?.layout).toBe("cards");
    expect(parseSlide(JSON.stringify({ layout: "stats", title: "Nothing" }))?.layout).toBe("title");
    expect(parseSlide(JSON.stringify({ layout: "cards" }))).toBeUndefined();
  });

  it("draws every chart type as well-formed SVG, with KPIs and insight", () => {
    for (const type of CHART_TYPES) {
      const spec = parseChart(JSON.stringify({ type, title: "T", unit: "$k", kpis: [{ label: "Total", value: "$4.2M", delta: "+38%" }], insight: "Up and to the right.", labels: ["a", "b", "c", "d", "e"], series: [{ name: "x", values: [3, 5, 2, 8, 6] }, { name: "y", values: [1, 2, 3, 4, 5] }] }));
      if (!spec) throw new Error("expected a spec");
      const svg = chartSvg(spec, 860, 600, CHART_THEMES.dark);
      assertWellFormed(svg);
      expect(svg).toContain("Up and to the right.");
    }
  });
});

describe("chart data helpers", () => {
  it("reads a pasted spreadsheet with or without headers", () => {
    const t = parseTable("Month\tRevenue\tCosts\nJan\t212\t318\nFeb\t$228\t322");
    expect(t?.labels).toEqual(["Jan", "Feb"]);
    expect(t?.series.map((s) => s.name)).toEqual(["Revenue", "Costs"]);
    expect(t?.series[0]?.values).toEqual([212, 228]);
    const csv = parseTable("A,1\nB,2\nC,3");
    expect(csv?.series[0]?.values).toEqual([1, 2, 3]);
    expect(parseTable("   ")).toBeUndefined();
  });

  it("works out headline numbers from the data", () => {
    const k = autoKpis(["Jan", "Feb", "Mar"], [{ name: "Sales", values: [100, 150, 200] }], "$");
    expect(k.map((x) => x.value)).toEqual(["$450", "Mar", "+100%"]);
  });
});

describe("template library", () => {
  it("has many templates, unique ids, every one builds valid shapes", () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    for (const t of TEMPLATES) {
      const shapes = t.build();
      expect(shapes.length, t.id).toBeGreaterThan(0);
      const keys = new Set(shapes.map((s) => s.key));
      expect(keys.size, t.id).toBe(shapes.length);
      for (const s of shapes) {
        if (s.props.from) expect(keys.has(s.props.from), t.id).toBe(true);
        if (s.props.to) expect(keys.has(s.props.to), t.id).toBe(true);
        if (s.props.kind === "slide") expect(parseSlide(s.props.data), t.id).toBeDefined();
        if (s.props.kind === "chart") expect(parseChart(s.props.data), t.id).toBeDefined();
      }
    }
  });
});
