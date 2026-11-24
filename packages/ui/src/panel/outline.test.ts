// The outline's headings mode: nesting by level across and within cells, and which other cells it lists.
import type { Cell } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { outlineOf } from "./outline.js";

const cell = (id: string, source: string, more: Partial<Cell> = {}): Cell => ({
  id,
  type: "markdown",
  source,
  index: 0,
  meta: {},
  status: "idle",
  stale: false,
  lastExecution: null,
  ...more,
});
const code = (id: string, more: Partial<Cell> = {}) =>
  cell(id, "const x = 1", { type: "server", ...more });
const names = new Map([
  ["t", "load users"],
  ["r", "x"],
  ["e", "x"],
]);
const shape = (cells: readonly Cell[]) =>
  outlineOf(cells, names).map((row) => `${"  ".repeat(row.depth)}${row.text}`);

describe("outlineOf", () => {
  it("nests headings by level, each heading of a cell its own row, levels skipped stay one deeper", () => {
    expect(
      shape([
        cell("a", "# **Intro**\ntext\n## [Setup](#setup)"),
        cell("b", "#### Deep"),
        cell("c", "Usage\n---"),
        cell("d", "```\n# not one\n```"),
        cell("e2", "# Next ##"),
      ]),
    ).toEqual(["Intro", "  Setup", "    Deep", "  Usage", "Next"]);
  });

  it("lists only the notable cells, under the last heading above them", () => {
    const rows = shape([
      code("plain"),
      cell("h", "# Data"),
      code("plain2", { status: "ok" }),
      code("t", { meta: { title: "load users" } }),
      code("r", { status: "running" }),
      cell("h2", "## Charts"),
      code("e", { status: "error" }),
      cell("prose", "just text"),
      code("blank", { meta: { title: "  " } }),
    ]);
    expect(rows).toEqual(["Data", "  load users", "  x", "  Charts", "    x"]);
    const reviewed = { lastEdit: { client: "mcp", at: "2026-11-24T10:00:00Z" } };
    const waiting = { lastEdit: { ...reviewed.lastEdit, review: { lines: [] } } };
    const meta = (value: object) => value as Cell["meta"];
    expect(outlineOf([code("a", { meta: meta(reviewed) })], names)).toEqual([]);
    expect(outlineOf([code("a", { meta: meta(waiting) })], names)).toHaveLength(1);
  });
});
