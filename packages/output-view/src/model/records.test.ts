// Tests records.ts: which arrays read as a grid and the cells of their rows.
import { describe, expect, it } from "vitest";

import { cellOf, gridOf } from "./records.js";

describe("gridOf records", () => {
  it("reads two or more objects sharing their keys as records, columns in first-seen order", () => {
    const grid = gridOf([
      { id: 1, name: "a" },
      { name: "b", id: 2, extra: true },
      { id: 3, name: "c" },
    ]);
    expect(grid?.shape).toBe("records");
    expect(grid?.columns.map((c) => c.key)).toEqual(["id", "name", "extra"]);
  });

  it("needs 60 % of the union of keys shared by every record", () => {
    const sixty = [
      { a: 1, b: 1, c: 1, d: 1 },
      { a: 1, b: 1, c: 1, e: 1 },
    ];
    const below = [
      { a: 1, b: 1, c: 1, d: 1 },
      { a: 1, b: 1, e: 1, f: 1 },
    ];
    expect([gridOf(sixty)?.shape, gridOf(below)]).toEqual(["records", undefined]);
  });

  it("refuses one record, mixed rows and records without keys", () => {
    expect([gridOf([{ a: 1 }]), gridOf([{ a: 1 }, 2]), gridOf([{}, {}]), gridOf({ a: 1 })]).toEqual(
      [undefined, undefined, undefined, undefined],
    );
  });
});

describe("gridOf rows", () => {
  it("reads class instances as records without their $class and labels escaped keys plainly", () => {
    const grid = gridOf([
      { $class: "P", $$type: 1 },
      { $class: "P", $$type: 2 },
    ]);
    expect(grid?.columns).toEqual([{ key: "$$type", label: "$type" }]);
  });

  it("resolves repeated rows and leaves the kernel's trailing truncated markers out", () => {
    const grid = gridOf([
      { id: 1 },
      { $type: "ref", path: [0] },
      { id: 2 },
      { $type: "truncated" },
    ]);
    expect(grid?.rows.map((r) => r.node)).toEqual([{ id: 1 }, { id: 1 }, { id: 2 }]);
    expect(grid?.omitted).toBe(1);
  });

  it("resolves a row against the root it was given", () => {
    const root = { shared: { id: 9 }, rows: [{ id: 1 }, { $type: "ref", path: ["shared"] }] };
    expect(gridOf(root.rows, root)?.rows[1]?.node).toEqual({ id: 9 });
    expect(gridOf([{ id: 1 }, { $type: "ref", path: "bad" }])).toBeUndefined();
  });
});

describe("gridOf matrices", () => {
  it("reads rows of one length as a matrix with columns 0 … n", () => {
    const grid = gridOf([
      [1, 2],
      [3, 4],
    ]);
    expect(grid?.shape).toBe("matrix");
    expect(grid?.columns).toEqual([
      { key: 0, label: "0" },
      { key: 1, label: "1" },
    ]);
  });

  it("refuses ragged rows and empty rows", () => {
    expect([gridOf([[1, 2], [3]]), gridOf([[], []])]).toEqual([undefined, undefined]);
  });
});

describe("cellOf", () => {
  it("is present with its kind when the row has the key, absent otherwise", () => {
    const row = { index: 0, node: { a: null } };
    expect(cellOf(row, { key: "a", label: "a" })).toEqual({
      present: true,
      node: null,
      kind: "null",
    });
    expect(cellOf(row, { key: "b", label: "b" })).toEqual({ present: false });
    expect(cellOf({ index: 1, node: [5] }, { key: 0, label: "0" })).toEqual({
      present: true,
      node: 5,
      kind: "number",
    });
    expect(cellOf({ index: 2, node: "x" }, { key: "a", label: "a" })).toEqual({ present: false });
  });
});
