// Tests tree.ts: the rows of a value under an expansion and a focus.
import { describe, expect, it } from "vitest";

import { expandAll, expansion, toggle } from "./expansion.js";
import { focusOf } from "./focus.js";
import type { Row } from "./tree.js";
import { flatten } from "./tree.js";

/** Rows as one line: `$.a ▾` for an open node, `$.a ▸` for a closed one, `close $.a#close`, `hidden $#hidden`. */
const shape = (rows: readonly Row[]): string =>
  rows
    .map((row) => {
      if (row.role !== "node") return `${row.role} ${row.id}`;
      return `${row.id}${row.hasChildren ? (row.expanded ? " ▾" : " ▸") : ""}`;
    })
    .join(" | ");

const value = { a: { b: { c: 1 } }, list: [1, 2], empty: {} };

describe("flatten", () => {
  it("is one row for a primitive", () => {
    const [root] = flatten("x");
    expect(root).toEqual({
      role: "node",
      id: "$",
      path: [],
      depth: 0,
      key: { kind: "root" },
      value: "x",
      kind: "string",
      hasChildren: false,
      count: 0,
      expanded: false,
      selected: false,
    });
  });

  it("opens to depth 2 by default, closing each open container", () => {
    expect(shape(flatten(value))).toBe(
      "$ ▾ | $.a ▾ | $.a.b ▸ | close $.a#close | $.list ▾ | $.list[0] | $.list[1] | close $.list#close | $.empty | close $#close",
    );
  });

  it("walks only what is open", () => {
    expect(shape(flatten(value, { expansion: expansion(1) }))).toBe(
      "$ ▾ | $.a ▸ | $.list ▸ | $.empty | close $#close",
    );
    expect(flatten(value, { expansion: expandAll() })).toHaveLength(12);
  });

  it("follows the user's toggles", () => {
    const closed = toggle(expansion(), { id: "$.list", expanded: true });
    expect(shape(flatten(value, { expansion: closed }))).toContain("$.list ▸");
  });
});

describe("flatten of Maps and Sets", () => {
  it("keys Map rows by their key node and Set rows by nothing", () => {
    const rows = flatten(
      { $type: "map", entries: [["k", { $type: "set", values: [1] }]] },
      { expansion: expandAll() },
    );
    const keys = rows.flatMap((row) => (row.role === "node" ? [[row.id, row.key]] : []));
    expect(keys).toEqual([
      ["$", { kind: "root" }],
      ["$.entries[0][1]", { kind: "entry", node: "k" }],
      ["$.entries[0][1].values[0]", { kind: "member" }],
    ]);
  });
});

describe("flatten with a focus", () => {
  it("reveals and marks the selection while showing everything", () => {
    const rows = flatten(value, {
      expansion: expansion(0),
      focus: focusOf([["a", "b", "c"]], false),
    });
    expect(shape(rows)).toBe(
      "$ ▾ | $.a ▾ | $.a.b ▾ | $.a.b.c | close $.a.b#close | close $.a#close | $.list ▸ | $.empty | close $#close",
    );
    expect(rows.flatMap((row) => (row.role === "node" && row.selected ? [row.id] : []))).toEqual([
      "$.a.b.c",
    ]);
  });

  it("hides what is neither selected, above nor inside a selection when only matches show", () => {
    const json = { data: [{ id: 1 }, { id: 2 }, { id: 3 }], more: true };
    const rows = flatten(json, { expansion: expandAll(), focus: focusOf([["data", 1]], true) });
    expect(shape(rows)).toBe(
      "$ ▾ | $.data ▾ | $.data[1] ▾ | $.data[1].id | close $.data[1]#close | hidden $.data#hidden | close $.data#close | hidden $#hidden | close $#close",
    );
    expect(rows.flatMap((row) => (row.role === "hidden" ? [row.count] : []))).toEqual([2, 1]);
  });
});
