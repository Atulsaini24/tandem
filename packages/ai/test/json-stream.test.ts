import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { JsonStreamParser, pathMatches, type JsonPath } from "../src/index.js";

/** Every value inside `value` (including itself), with its path: the reference answer. */
function allValues(value: unknown, path: JsonPath = []): Array<[JsonPath, unknown]> {
  const out: Array<[JsonPath, unknown]> = [];
  if (Array.isArray(value)) value.forEach((child, i) => out.push(...allValues(child, [...path, i])));
  else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) out.push(...allValues(child, [...path, key]));
  }
  out.push([path, value]);
  return out;
}

const canonical = (entries: Array<[JsonPath, unknown]>): string[] => entries.map((e) => JSON.stringify(e)).sort();

/** Cut a string into chunks at random places. */
function chunked(text: string, cuts: readonly number[]): string[] {
  const points = [...new Set(cuts.map((c) => c % (text.length + 1)))].sort((a, b) => a - b);
  const out: string[] = [];
  let last = 0;
  for (const p of points) {
    out.push(text.slice(last, p));
    last = p;
  }
  out.push(text.slice(last));
  return out;
}

describe("JsonStreamParser", () => {
  it("PROPERTY: for any JSON, cut anywhere, reports exactly the values JSON.parse sees, with paths", () => {
    fc.assert(
      fc.property(
        fc.jsonValue({ maxDepth: 4 }).filter((v) => typeof v === "object" && v !== null),
        fc.array(fc.nat(), { maxLength: 30 }),
        fc.boolean(),
        (value, cuts, pretty) => {
          const text = pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
          const parser = new JsonStreamParser();
          const seen = chunked(text, cuts).flatMap((chunk) => parser.push(chunk).map((c) => [c.path, c.value] as [JsonPath, unknown]));
          expect(canonical(seen)).toEqual(canonical(allValues(JSON.parse(text))));
        },
      ),
      { numRuns: 2_000 },
    );
  });

  it("reports an item the moment its closing brace arrives, before the document ends", () => {
    const parser = new JsonStreamParser();
    expect(parser.push('{"title":"Launch","columns":[{"title":"Now","items":[{"text":"Ship')).toEqual([
      { path: ["title"], value: "Launch" },
      { path: ["columns", 0, "title"], value: "Now" },
    ]);
    const next = parser.push(' it"},');
    expect(next.map((e) => e.path)).toEqual([["columns", 0, "items", 0, "text"], ["columns", 0, "items", 0]]);
    expect(next[1]?.value).toEqual({ text: "Ship it" });
  });

  it("handles escapes and braces inside strings", () => {
    const parser = new JsonStreamParser();
    const events = parser.push('{"a":"x\\"}{[,","b":["]"]}');
    expect(events.find((e) => pathMatches(e.path, ["a"]))?.value).toBe('x"}{[,');
    expect(events.find((e) => pathMatches(e.path, ["b", 0]))?.value).toBe("]");
  });

  it("never throws on garbage and keeps the values that are valid", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (garbage) => {
        expect(() => new JsonStreamParser().push(garbage)).not.toThrow();
      }),
    );
    const events = new JsonStreamParser().push('{"ok":1,"bad":tru,"also":2}');
    expect(events.find((e) => pathMatches(e.path, ["ok"]))?.value).toBe(1);
    expect(events.find((e) => pathMatches(e.path, ["also"]))?.value).toBe(2);
  });

  it("pathMatches uses # for any index", () => {
    expect(pathMatches(["columns", 3, "items", 0], ["columns", "#", "items", "#"])).toBe(true);
    expect(pathMatches(["columns", "x", "items", 0], ["columns", "#", "items", "#"])).toBe(false);
    expect(pathMatches(["columns", 3], ["columns", "#", "items", "#"])).toBe(false);
  });
});
