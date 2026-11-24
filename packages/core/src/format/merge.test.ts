// Tests mergeCells: the three-way merge by cell id of external edits, as a table of base, ours and theirs.
import { describe, expect, it } from "vitest";

import type { MergeConflict } from "./merge.js";
import { mergeCells, sameJson } from "./merge.js";
import type { DocumentCell } from "./schema.js";

type Short = string | (Partial<DocumentCell> & { readonly id: string });

/** "a" is the cell c_a with source "a"; "a=x" the cell c_a with source "x"; an object names its fields. */
function cell(short: Short): DocumentCell {
  if (typeof short !== "string")
    return { type: "server", source: "", meta: {}, extra: {}, ...short, id: `c_${short.id}` };
  const [id = "", source = id] = short.split("=");
  return { id: `c_${id}`, type: "server", source, meta: {}, extra: {} };
}
const cells = (list: readonly Short[]) => list.map(cell);
const edit = (client: "ui" | "file", at: string) => ({
  lastEdit: { by: client === "ui" ? ("user" as const) : ("external" as const), client, at },
});

type Case = {
  readonly name: string;
  readonly base: readonly Short[];
  readonly ours: readonly Short[];
  readonly theirs: readonly Short[];
  /** The result's cells, when it has no conflict. */
  readonly result?: readonly Short[];
  readonly conflicts?: readonly MergeConflict[];
  readonly fromTheirs?: readonly string[];
  readonly removed?: readonly string[];
  readonly keepsOurs?: boolean;
  readonly busy?: readonly string[];
};

const cases: readonly Case[] = [
  {
    name: "no change on either side",
    base: ["a", "b"],
    ours: ["a", "b"],
    theirs: ["a", "b"],
    result: ["a", "b"],
    keepsOurs: false,
  },
  {
    name: "theirs only: the file is taken",
    base: ["a", "b", "c"],
    ours: ["a", "b", "c"],
    theirs: ["a=x", "d", "c"],
    result: ["a=x", "d", "c"],
    fromTheirs: ["c_a", "c_d"],
    removed: ["c_b"],
    keepsOurs: false,
  },
  {
    name: "ours only: the session is kept",
    base: ["a", "b"],
    ours: ["b=y", "a", "n"],
    theirs: ["a", "b"],
    result: ["b=y", "a", "n"],
    keepsOurs: true,
  },
  {
    name: "different cells on each side merge",
    base: ["a", "b", "c"],
    ours: ["a=x", "b", "c", "n"],
    theirs: ["a", "b=y", "t", "c"],
    result: ["a=x", "b=y", "t", "c", "n"],
    fromTheirs: ["c_b", "c_t"],
    keepsOurs: true,
  },
  {
    name: "the same change on both sides is no conflict",
    base: ["a"],
    ours: ["a=x"],
    theirs: ["a=x"],
    result: ["a=x"],
    keepsOurs: false,
  },
  {
    name: "the same cell changed differently is a conflict",
    base: ["a", "b"],
    ours: ["a=x", "b"],
    theirs: ["a=y", "b=z"],
    conflicts: [{ cell: "c_a", reason: "bothChanged" }],
  },
  {
    name: "source on one side and type on the other merge",
    base: ["a"],
    ours: ["a=x"],
    theirs: [{ id: "a", source: "a", type: "client" }],
    result: [{ id: "a", source: "x", type: "client" }],
    fromTheirs: ["c_a"],
    keepsOurs: true,
  },
  {
    name: "different meta keys merge, the same key changed differently conflicts",
    base: [{ id: "a", source: "a", meta: { collapsed: false } }],
    ours: [{ id: "a", source: "a", meta: { collapsed: true } }],
    theirs: [{ id: "a", source: "a", meta: { collapsed: false, title: "T" } }],
    result: [{ id: "a", source: "a", meta: { collapsed: true, title: "T" } }],
    keepsOurs: true,
  },
  {
    name: "a meta key changed differently is a conflict",
    base: [{ id: "a", source: "a", meta: { title: "A" } }],
    ours: [{ id: "a", source: "a", meta: { title: "B" } }],
    theirs: [{ id: "a", source: "a", meta: { title: "C" } }],
    conflicts: [{ cell: "c_a", reason: "bothChanged" }],
  },
  {
    name: "lastEdit never conflicts and follows ours when ours changed it",
    base: [{ id: "a", source: "a" }],
    ours: [{ id: "a", source: "x", meta: edit("ui", "1") }],
    theirs: [
      { id: "b", source: "b", meta: edit("file", "2") },
      { id: "a", source: "a" },
    ],
    result: [
      { id: "b", source: "b", meta: edit("file", "2") },
      { id: "a", source: "x", meta: edit("ui", "1") },
    ],
    fromTheirs: ["c_b"],
    keepsOurs: true,
  },
  {
    name: "a stamp only ours has does not keep ours",
    base: ["a"],
    ours: [{ id: "a", source: "a", meta: edit("file", "1") }],
    theirs: ["a=x"],
    result: [{ id: "a", source: "x", meta: edit("file", "1") }],
    fromTheirs: ["c_a"],
    keepsOurs: false,
  },
  {
    name: "removed on disk, unchanged here: it goes",
    base: ["a", "b"],
    ours: ["a", "b"],
    theirs: ["a"],
    result: ["a"],
    removed: ["c_b"],
    keepsOurs: false,
  },
  {
    name: "removed on disk, changed here: a conflict",
    base: ["a", "b"],
    ours: ["a", "b=x"],
    theirs: ["a"],
    conflicts: [{ cell: "c_b", reason: "removedOnDisk" }],
  },
  {
    name: "removed here, unchanged on disk: it stays removed",
    base: ["a", "b"],
    ours: ["a"],
    theirs: ["a", "b"],
    result: ["a"],
    keepsOurs: true,
  },
  {
    name: "removed here, changed on disk: a conflict",
    base: ["a", "b"],
    ours: ["a"],
    theirs: ["a", "b=x"],
    conflicts: [{ cell: "c_b", reason: "removedHere" }],
  },
  {
    name: "removed on both sides",
    base: ["a", "b"],
    ours: ["a"],
    theirs: ["a"],
    result: ["a"],
    keepsOurs: false,
  },
  {
    name: "added on both sides with one id and the same content",
    base: [],
    ours: ["n"],
    theirs: ["n"],
    result: ["n"],
    keepsOurs: false,
  },
  {
    name: "added on both sides with one id and different content: a conflict",
    base: [],
    ours: ["n=1"],
    theirs: ["n=2"],
    conflicts: [{ cell: "c_n", reason: "bothAdded" }],
  },
  {
    name: "reordered on disk only: the disk's order, ours' new cell after its neighbour",
    base: ["a", "b", "c"],
    ours: ["a", "n", "b", "c"],
    theirs: ["c", "b", "a"],
    result: ["c", "b", "a", "n"],
    keepsOurs: true,
  },
  {
    name: "reordered here only: ours' order, the disk's new cell after its neighbour",
    base: ["a", "b", "c"],
    ours: ["c", "a", "b"],
    theirs: ["t", "a", "b", "c"],
    result: ["t", "c", "a", "b"],
    fromTheirs: ["c_t"],
    keepsOurs: true,
  },
  {
    name: "reordered differently on both sides: a conflict",
    base: ["a", "b", "c"],
    ours: ["b", "a", "c"],
    theirs: ["a", "c", "b"],
    conflicts: [{ cell: null, reason: "order" }],
  },
  {
    name: "a busy cell changed on disk is a conflict even when ours matches the base",
    base: ["a", "b"],
    ours: ["a", "b"],
    theirs: ["a=x", "b"],
    busy: ["c_a"],
    conflicts: [{ cell: "c_a", reason: "bothChanged" }],
  },
  {
    name: "a busy cell the disk left alone merges",
    base: ["a", "b"],
    ours: ["a", "b"],
    theirs: ["a", "b=y"],
    busy: ["c_a"],
    result: ["a", "b=y"],
    fromTheirs: ["c_b"],
    keepsOurs: false,
  },
  {
    name: "a busy cell removed on disk is a conflict",
    base: ["a", "b"],
    ours: ["a", "b"],
    theirs: ["b"],
    busy: ["c_a"],
    conflicts: [{ cell: "c_a", reason: "removedOnDisk" }],
  },
  {
    name: "unknown keys merge like fields",
    base: [{ id: "a", extra: { x: 1 } }],
    ours: [{ id: "a", extra: { x: 1 }, source: "s" }],
    theirs: [{ id: "a", extra: { x: 2 } }],
    result: [{ id: "a", extra: { x: 2 }, source: "s" }],
    keepsOurs: true,
  },
];

describe("mergeCells", () => {
  it.each(cases)("$name", (c) => {
    const merged = mergeCells(cells(c.base), cells(c.ours), cells(c.theirs), {
      busy: new Set(c.busy ?? []),
    });
    expect(merged.conflicts).toEqual(c.conflicts ?? []);
    if (c.result !== undefined) expect(merged.cells).toEqual(cells(c.result));
    if (c.fromTheirs !== undefined) expect(merged.fromTheirs).toEqual(c.fromTheirs);
    else if (c.conflicts === undefined) expect(merged.fromTheirs).toEqual([]);
    if (c.removed !== undefined) expect(merged.removed).toEqual(c.removed);
    if (c.keepsOurs !== undefined) expect(merged.keepsOurs).toBe(c.keepsOurs);
  });

  it("keeps ours for a conflicting cell until the conflict is resolved", () => {
    const merged = mergeCells(cells(["a"]), cells(["a=x"]), cells(["a=y"]));
    expect(merged.cells).toEqual(cells(["a=x"]));
  });
});

describe("sameJson", () => {
  it("ignores key order and undefined values, and tells arrays from objects", () => {
    expect(sameJson({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(sameJson({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(sameJson([1], { 0: 1 })).toBe(false);
    expect(sameJson([1, 2], [1])).toBe(false);
    expect(sameJson({ a: 1 }, { b: 1 })).toBe(false);
    expect(sameJson(null, {})).toBe(false);
  });
});
