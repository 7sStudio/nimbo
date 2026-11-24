// The Search view's matches: the lines of each cell that hold the text, case aside unless asked, at most 20 a cell with
// the rest counted, nothing for an empty or blank search; and notebook file names.
import { describe, expect, it } from "vitest";

import { cellHits, fileHits, linesWith, perCell } from "./searchHits.js";

describe("searchHits", () => {
  it("finds the lines that hold the text with the first match on each, case aside unless asked", () => {
    expect(linesWith("const Amount = 1;\nreturn amount + amount;", "amount")).toEqual([
      { line: 1, text: "const Amount = 1;", from: 6, to: 12 },
      { line: 2, text: "return amount + amount;", from: 7, to: 13 },
    ]);
    expect(linesWith("const Amount = 1;\namount", "amount", true).map((hit) => hit.line)).toEqual([
      2,
    ]);
    expect(linesWith("x", "")).toEqual([]);
  });

  it("groups by cell in order with its number, keeps 20 lines a cell and counts the rest, and skips a blank search", () => {
    const many = Array.from({ length: 25 }, () => "hit").join("\n");
    const cells = [
      { id: "c_1", type: "server" as const, name: "a", text: "nothing" },
      { id: "c_2", type: "client" as const, name: "b", text: many },
    ];
    const found = cellHits(cells, "HIT");
    expect(found.map((each) => [each.cell, each.number, each.lines.length, each.total])).toEqual([
      ["c_2", 2, perCell, 25],
    ]);
    expect(cellHits(cells, "  ")).toEqual([]);
  });

  it("finds notebooks by their path, case aside", () => {
    expect(fileHits(["demo.jsnb", "reports/Weekly.jsnb"], "WEEK")).toEqual(["reports/Weekly.jsnb"]);
    expect(fileHits(["demo.jsnb"], " ")).toEqual([]);
  });
});
