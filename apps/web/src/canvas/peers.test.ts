import { describe, expect, it } from "vitest";
import type { Presence } from "@canvas/sync";
import { Peers } from "./peers";

const at = (x: number, name = "Ana"): Presence => ({ name, color: 0x2f63ff, cursor: { x, y: 0 }, selection: [] });

describe("Peers", () => {
  it("reports roster changes only for joins, leaves and renames", () => {
    const peers = new Peers();
    expect(peers.update("a", at(0))).toBe(true); // joined
    expect(peers.update("a", at(50))).toBe(false); // just moved
    expect(peers.update("a", at(50, "Ana B"))).toBe(true); // renamed
    expect(peers.update("a", null)).toBe(true); // left
    expect(peers.list()).toEqual([]);
  });

  it("glides the cursor toward its target, frame-rate independently", () => {
    const at60 = new Peers();
    const at120 = new Peers();
    for (const p of [at60, at120]) {
      p.update("a", at(0));
      p.update("a", at(100));
    }
    for (let i = 0; i < 6; i++) at60.step(1000 / 60);
    for (let i = 0; i < 12; i++) at120.step(1000 / 120);
    const x60 = at60.list()[0]?.shown?.x ?? 0;
    expect(x60).toBeGreaterThan(50);
    expect(x60).toBeLessThan(100);
    expect(at120.list()[0]?.shown?.x).toBeCloseTo(x60, 6);
  });
});
