import { describe, expect, it } from "vitest";
import { parseRoute } from "./router";

describe("routes", () => {
  it("parses every page", () => {
    expect(parseRoute("/", "")).toEqual({ page: "home" });
    expect(parseRoute("/boards", "")).toEqual({ page: "boards" });
    expect(parseRoute("/b/abc_1", "?template=kanban")).toEqual({ page: "board", docId: "abc_1", template: "kanban", viewMode: false });
    expect(parseRoute("/b/abc", "?mode=view&token=t")).toEqual({ page: "board", docId: "abc", viewMode: true, token: "t" });
  });

  it("keeps old ?doc= links working and rejects bad ids", () => {
    expect(parseRoute("/", "?doc=team")).toMatchObject({ page: "board", docId: "team" });
    expect(parseRoute("/b/bad%20id", "")).toEqual({ page: "home" });
    expect(parseRoute("/nope", "")).toEqual({ page: "home" });
  });
});
