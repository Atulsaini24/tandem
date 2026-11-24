import type { ShapeView } from "@canvas/doc";
import { describe, expect, it } from "vitest";
import { artSvg, composeArt, parseArt, type ArtItem } from "./art";
import { diffBranch } from "./branch";
import { mentions, repliesOf, splitMentions } from "./comments";
import { chartFromTable, guessChartType } from "./csv-chart";
import { embedFromUrl, embedSrc, parseEmbed, parsePoll, tally } from "./widgets";

const shape = (id: string, over: Partial<ShapeView> = {}): ShapeView => ({ id, kind: "rect", x: 0, y: 0, w: 100, h: 100, fill: 0xffd84d, ...over });

describe("embeds", () => {
  it("turns YouTube links into privacy-friendly embeds", () => {
    const spec = embedFromUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10");
    const short = embedFromUrl("https://youtu.be/dQw4w9WgXcQ");
    if (!spec || !short) throw new Error("expected YouTube embeds");
    expect(spec.type).toBe("youtube");
    expect(embedSrc(spec)).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(embedSrc(short)).toContain("/embed/dQw4w9WgXcQ");
  });

  it("only ever embeds https pages, never script or plain-http URLs", () => {
    expect(embedFromUrl("http://example.com")).toBeUndefined();
    expect(embedFromUrl("javascript:alert(1)")).toBeUndefined();
    expect(embedSrc({ type: "web", url: "javascript:alert(1)", title: "", code: "", language: "" })).toBeUndefined();
    expect(embedFromUrl("https://www.figma.com/file/abc/Design")?.type).toBe("figma");
  });

  it("reads stored embeds defensively", () => {
    expect(parseEmbed("not json")).toBeUndefined();
    expect(parseEmbed(JSON.stringify({ type: "evil", url: "https://a.dev" }))?.type).toBe("web");
  });
});

describe("polls", () => {
  const parsed = parsePoll(JSON.stringify({ question: "Lunch?", options: ["Pizza", "Sushi", "Tacos"] }));
  if (!parsed) throw new Error("expected a poll");
  const spec = parsed;

  it("needs a question and at least two options", () => {
    expect(spec.options).toEqual(["Pizza", "Sushi", "Tacos"]);
    expect(parsePoll(JSON.stringify({ question: "?", options: ["only one"] }))).toBeUndefined();
  });

  it("counts each person once and ignores junk keys", () => {
    const t = tally(spec, ["ana#0", "bo#1", "cy#1", "cy#2", "junk", "dee#9", "#1"]);
    expect(t.counts).toEqual([1, 1, 1]); // cy's two votes collapse to one
    expect(t.total).toBe(3);
    expect(t.mine("bo")).toBe(1);
    expect(t.mine("nobody")).toBeUndefined();
  });
});

describe("illustrations", () => {
  const item = (icon: ArtItem["icon"], size: number): ArtItem => ({ icon, x: 200, y: 200, size, color: "#5b8cff", accent: "#ffb547", rotate: 0 });

  it("makes the biggest item the hero and drops duplicate props (decor may repeat)", () => {
    const out = composeArt([item("coffee", 120), item("robot", 220), item("coffee", 100), item("star", 40), item("star", 40)], false);
    expect(out[0]?.icon).toBe("robot");
    expect(out.filter((i) => i.icon === "coffee")).toHaveLength(1);
    expect(out.filter((i) => i.icon === "star")).toHaveLength(2);
  });

  it("rejects unsafe paths and colors from the model", () => {
    const spec = parseArt(JSON.stringify({ shapes: [{ type: "path", d: "M0 0 L10 10\"/><script>" }, { type: "circle", x: 10, y: 10, r: 5, fill: "url(javascript:1)" }] }));
    expect(spec?.shapes).toHaveLength(1);
    expect(spec?.shapes[0]?.fill).toBe("#5b8cff");
    expect(spec && artSvg(spec, 400, 400)).not.toContain("script");
  });

  it("reads a composed scene", () => {
    const spec = parseArt(JSON.stringify({ background: "sunset", items: [{ icon: "rocket", size: 200 }, { icon: "nope" }], text: "Launch!", textStyle: "banner" }));
    expect(spec?.scene?.items.map((i) => i.icon)).toEqual(["rocket"]);
    expect(spec?.scene?.textStyle).toBe("banner");
  });
});

describe("charts from files", () => {
  it("picks a chart that fits the data", () => {
    expect(guessChartType(["Jan", "Feb", "Mar", "Apr"], [{ values: [1, 2, 3, 4] }])).toMatch(/line|area/);
    expect(guessChartType(["North", "South"], [{ values: [1, 2] }, { values: [3, 4] }, { values: [5, 6] }])).toBe("stacked");
  });

  it("builds a titled chart from a CSV, named after the file", () => {
    const chart = chartFromTable("Month,Revenue ($)\nJan,120\nFeb,180\nMar,240\n", "monthly-sales.csv");
    expect(chart?.title).toBe("Monthly sales");
    expect(chart?.labels).toEqual(["Jan", "Feb", "Mar"]);
  });
});

describe("comment threads", () => {
  it("highlights known names after @, longest name first", () => {
    const parts = splitMentions("hi @Ana Lee and @Ana, not @bob", ["Ana", "Ana Lee"]);
    expect(parts.filter((p) => p.mention).map((p) => p.text)).toEqual(["@Ana Lee", "@Ana"]);
    expect(mentions("ping @ana lee", "Ana Lee")).toBe(true);
    expect(mentions("email ana@lee.dev", "lee")).toBe(false);
    expect(mentions("cc @Anastasia", "Ana")).toBe(false);
    expect(mentions("thanks @Ana!", "Ana")).toBe(true);
  });

  it("reads replies defensively and keeps their order", () => {
    const view = shape("c", { kind: "comment", replies: [{ key: "a1", value: JSON.stringify({ a: "Ana", t: "first", at: 1 }) }, { key: "a2", value: "{bad" }, { key: "a3", value: JSON.stringify({ a: "Bo", t: "  " }) }] });
    expect(repliesOf(view).map((r) => r.text)).toEqual(["first"]);
  });
});

describe("branch diff", () => {
  it("finds added, removed and per-property changes", () => {
    const base = [shape("a"), shape("b", { label: "old" }), shape("c")];
    const now = [shape("a"), shape("b", { label: "new", x: 50 }), shape("d")];
    const ops = diffBranch(base, now);
    expect(ops.added.map((s) => s.id)).toEqual(["d"]);
    expect(ops.removed).toEqual(["c"]);
    expect(ops.changed).toEqual([{ id: "b", patch: { label: "new", x: 50 } }]);
  });
});
