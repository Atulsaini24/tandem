import { describe, expect, it } from "vitest";
import { CHART_THEMES, chartSvg, parseChart } from "./charts";
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
  it("clamps positions and sizes, defaults unknown values", () => {
    const spec = parseScene(JSON.stringify({ backdrop: "moon", objects: [{ shape: "dodecahedron", color: "blue", position: [1e9, 0, "x"], size: [-5, 2, 2] }] }));
    const o = spec?.objects[0];
    expect(spec?.backdrop).toBe("studio");
    expect(o?.shape).toBe("box");
    expect(o?.color).toBe("#3d7bff");
    expect(o?.position).toEqual([30, 0, 0]);
    expect(o?.size[0]).toBe(0.05);
  });

  it("keeps light sources still: a glowing object never orbits", () => {
    const spec = parseScene(JSON.stringify({ objects: [{ shape: "sphere", glow: true, motion: "orbit", position: [0, 0, 0], size: [2, 2, 2] }, { shape: "sphere", motion: "orbit", orbitRadius: 5, position: [5, 0, 0], size: [1, 1, 1] }] }));
    expect(spec?.objects.map((o) => o.motion)).toEqual(["spin", "orbit"]);
    if (!spec) throw new Error("expected a spec");
    expect(sceneRadius(spec)).toBeGreaterThanOrEqual(5);
    expect(parseScene(JSON.stringify({ objects: [] }))).toBeUndefined();
  });
});
