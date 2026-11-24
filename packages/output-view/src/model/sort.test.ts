// Tests sort.ts: the order a header click sorts a grid column in.
import { describe, expect, it } from "vitest";

import type { Cell } from "./records.js";
import { compareCells } from "./sort.js";
import { kindOf } from "./wire.js";

const cell = (node: unknown): Cell => ({ present: true, node, kind: kindOf(node) });
const absent: Cell = { present: false };
const sorted = (cells: Cell[]): unknown[] =>
  cells.sort(compareCells).map((c) => (c.present ? c.node : "∅"));

describe("compareCells", () => {
  it("sorts numbers numerically, bigints and special numbers among them", () => {
    const big = { $type: "bigint", value: "100000000000000000000" };
    const nan = { $type: "number", value: "NaN" };
    const inf = { $type: "number", value: "Infinity" };
    expect(sorted([cell(10), cell(big), cell(2), cell(inf), cell(nan), cell(-1)])).toEqual([
      nan,
      -1,
      2,
      10,
      big,
      inf,
    ]);
  });

  it("puts numbers, strings, dates, booleans, the rest, null and absent in that order", () => {
    const date = { $type: "date", iso: "2026-10-10T14:02:11.000Z" };
    expect(
      sorted([absent, cell(null), cell(true), cell(date), cell("b"), cell(1), cell({ a: 1 })]),
    ).toEqual([1, "b", date, true, { a: 1 }, null, "∅"]);
  });

  it("sorts strings, dates and booleans within their kind", () => {
    const early = { $type: "date", iso: "2025-01-01T00:00:00.000Z" };
    const late = { $type: "date", iso: "2026-01-01T00:00:00.000Z" };
    const invalid = { $type: "date", iso: null };
    expect(sorted([cell("b"), cell("a")])).toEqual(["a", "b"]);
    expect(sorted([cell(late), cell(invalid), cell(early)])).toEqual([invalid, early, late]);
    expect(sorted([cell(true), cell(false)])).toEqual([false, true]);
  });

  it("treats two absent cells and two equal cells as equal", () => {
    expect([
      compareCells(absent, absent),
      compareCells(cell(1), cell(1)),
      compareCells(cell(Number.NaN), cell(1)),
    ]).toEqual([0, 0, 0]);
  });
});
