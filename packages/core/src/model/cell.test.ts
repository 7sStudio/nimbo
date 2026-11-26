// Tests the Cell schema and the meta key order.
import { describe, expect, it } from "vitest";

import { Cell, CellMeta, cellMetaKeys, cellMetaShape } from "./cell.js";

const cell = {
  id: "c_a1b2c3",
  type: "server",
  source: "const n = 1",
  index: 0,
  meta: {},
  status: "idle",
  stale: false,
  lastExecution: null,
};

describe("Cell", () => {
  it("accepts a fresh cell and one with a last execution summary", () => {
    expect(Cell.safeParse(cell).success).toBe(true);
    const ran = {
      ...cell,
      status: "ok",
      lastExecution: {
        id: "x_9f8e7d6c",
        status: "ok",
        startedAt: "2026-10-10T14:02:11Z",
        durationMs: 9,
        hasError: false,
        defines: ["n"],
      },
    };
    expect(Cell.parse(ran).lastExecution?.defines).toEqual(["n"]);
  });

  it("rejects an unknown cell type and a negative index", () => {
    expect(Cell.safeParse({ ...cell, type: "python" }).success).toBe(false);
    expect(Cell.safeParse({ ...cell, index: -1 }).success).toBe(false);
  });
});

describe("CellMeta", () => {
  it("lists the keys the file writes, in order", () => {
    expect(cellMetaKeys).toEqual([
      "title",
      "showBindings",
      "collapsed",
      "headingCollapsed",
      "outputsHidden",
      "outputView",
      "outputQuery",
      "outputHeight",
      "outputColumns",
      "manual",
      "lastEdit",
    ]);
    expect(Object.keys(cellMetaShape)).toEqual([...cellMetaKeys]);
  });

  it("accepts a pinned query and an edit stamp", () => {
    const meta = CellMeta.parse({
      outputQuery: { mode: "jsonpath", query: "$.data[*]" },
      lastEdit: { by: "agent", client: "mcp", agent: "claude-code", at: "2026-10-10T14:05:40Z" },
    });
    expect(meta.outputQuery?.mode).toBe("jsonpath");
    expect(CellMeta.safeParse({ outputHeight: "tall" }).success).toBe(false);
  });

  it("keeps a pinned filter's node, and refuses one that is not a string", () => {
    const pinned = { mode: "filter", query: "status = failed", at: "$.data" } as const;
    expect(CellMeta.parse({ outputQuery: pinned }).outputQuery).toEqual(pinned);
    expect(CellMeta.safeParse({ outputQuery: { ...pinned, at: 1 } }).success).toBe(false);
  });
});
