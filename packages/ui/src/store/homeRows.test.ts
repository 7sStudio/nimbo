// The Home list's order: folders with the workspace root first, rows by name, the order ↑ ↓ follow with
// a folded folder left out, the step clamped at the ends, and the path a new notebook's form names.
import type { NotebookEntry } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { folderLabel, groupsOf, newPath, rowOrder, splitPath, stepFrom } from "./homeRows.js";

const entry = (path: string): NotebookEntry => ({
  path,
  open: false,
  modifiedAt: null,
  bytes: null,
});
const list = ["sub/b.jsnb", "z.jsnb", "a.jsnb", "sub/a.jsnb", "deep/er/x.jsnb"].map(entry);

describe("the Home list's groups and order", () => {
  it("puts the root first, then each folder by name, each folder's notebooks by name", () => {
    const groups = groupsOf(list);
    expect(groups.map((group) => [group.folder, group.label])).toEqual([
      ["", "Workspace root"],
      ["deep/er", "deep/er"],
      ["sub", "sub"],
    ]);
    expect(groups[2]?.notebooks.map((each) => each.path)).toEqual(["sub/a.jsnb", "sub/b.jsnb"]);
    expect(groupsOf([])).toEqual([]);
    expect(folderLabel("")).toBe("Workspace root");
  });

  it("orders the rows as shown", () => {
    const groups = groupsOf(list);
    expect(rowOrder(groups)).toEqual([
      "a.jsnb",
      "z.jsnb",
      "deep/er/x.jsnb",
      "sub/a.jsnb",
      "sub/b.jsnb",
    ]);
  });

  it("steps from the selection, clamped at the ends, from the first or the last with none", () => {
    const order = ["a", "b", "c"];
    expect(stepFrom(order, null, 1)).toBe("a");
    expect(stepFrom(order, null, -1)).toBe("c");
    expect(stepFrom(order, "gone", 1)).toBe("a");
    expect(stepFrom(order, "a", 1)).toBe("b");
    expect(stepFrom(order, "c", 1)).toBe("c");
    expect(stepFrom(order, "a", -1)).toBe("a");
    expect(stepFrom([], "a", 1)).toBeNull();
  });
});

describe("splitPath and newPath", () => {
  it("splits a ref into its folder and name", () => {
    expect(splitPath("a.jsnb")).toEqual({ folder: "", name: "a.jsnb" });
    expect(splitPath("x/y/a.jsnb")).toEqual({ folder: "x/y", name: "a.jsnb" });
  });

  it("adds .jsnb when missing and joins the folder, trimming spaces and slashes", () => {
    expect(newPath("first", "")).toBe("first.jsnb");
    expect(newPath(" first.jsnb ", " /sub/ ")).toBe("sub/first.jsnb");
    expect(newPath("/a/b/", "x")).toBe("x/a/b.jsnb");
  });
});
