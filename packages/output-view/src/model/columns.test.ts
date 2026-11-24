// Tests the grid's column layout (meta.outputColumns): hidden columns out, the user's order first,
// keys the grid lost ignored, the last shown column never hidden.
import { describe, expect, it } from "vitest";

import {
  arrangeColumns,
  arrangeGrid,
  gridOf,
  hideColumn,
  moveColumn,
  showAllColumns,
} from "./records.js";

const grid = gridOf([
  { a: 1, b: 2, c: 3 },
  { a: 4, b: 5, c: 6 },
]);
if (grid === undefined) throw new Error("expected a grid");
const keys = (layout: Parameters<typeof arrangeColumns>[1]) =>
  arrangeColumns(grid.columns, layout).map((column) => column.key);

describe("column layout", () => {
  it("hides, orders and ignores unknown keys", () => {
    expect(keys(undefined)).toEqual(["a", "b", "c"]);
    expect(keys({ hidden: ["b"], order: ["c", "gone", "a"] })).toEqual(["c", "a"]);
  });

  it("moves a shown column and keeps hidden ones at the end of the order", () => {
    const hidden = hideColumn(grid, undefined, "a");
    expect(hidden).toEqual({ hidden: ["a"] });
    const moved = moveColumn(grid, hidden, "c", 0);
    expect(keys(moved)).toEqual(["c", "b"]);
    expect(keys(showAllColumns(moved))).toEqual(["c", "b", "a"]);
  });

  it("never hides the last shown column", () => {
    const two = hideColumn(grid, hideColumn(grid, undefined, "a"), "b");
    expect(hideColumn(grid, two, "c")).toEqual(two);
    expect(arrangeGrid(grid, { hidden: ["a", "b", "c"] }).columns).toHaveLength(3);
  });
});
