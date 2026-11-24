import { describe, expect, it } from "vitest";
import { cleanVision, isVisionModel } from "../src/index.js";

describe("photo → board", () => {
  it("keeps readable items, fixes bad fields and drops links to nowhere", () => {
    const out = cleanVision({
      title: "Retro",
      items: [
        { id: "a", text: "Went well", kind: "note", color: "green", x: 10, y: 10, w: 20, h: 15 },
        { id: "a", text: "Duplicate id", kind: "sticker", color: "plaid", x: 500, y: -4 },
        { id: "g", text: "", kind: "group", x: 0, y: 0, w: 60, h: 60 },
        { id: "z", text: "", kind: "note" },
        "junk",
      ],
      links: [
        { from: "a", to: "g" },
        { from: "a", to: "missing" },
        { from: "a", to: "a" },
      ],
    });
    expect(out.title).toBe("Retro");
    expect(out.items.map((i) => i.id)).toEqual(["a", "a-1", "g"]); // empty note dropped, id de-duplicated
    expect(out.items[1]).toMatchObject({ kind: "note", color: "yellow" });
    expect(out.items[1]?.x).toBeLessThanOrEqual(100);
    expect(out.items[1]?.y).toBeGreaterThanOrEqual(0);
    expect(out.links).toEqual([{ from: "a", to: "g", label: "" }]);
    expect(cleanVision(null)).toEqual({ title: "From a photo", items: [], links: [] });
  });

  it("knows which local models can see images", () => {
    expect(isVisionModel("gemma3:4b")).toBe(true);
    expect(isVisionModel("llava:7b")).toBe(true);
    expect(isVisionModel("qwen3:4b")).toBe(false);
  });
});
