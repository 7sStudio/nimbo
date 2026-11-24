// Tests the name metadata: creation by the trap, attribution after ok and error runs, kinds and their fallbacks.
import { describe, expect, it } from "vitest";

import type { RunFacts } from "./names.js";
import { createNames } from "./names.js";

const run = (facts: Partial<RunFacts>): RunFacts => ({
  cell: "c_bbbbbb",
  ok: true,
  defines: [],
  kinds: {},
  before: new Map(),
  record: {},
  ...facts,
});

describe("createNames after an ok run", () => {
  it("records a created name as var from the creating cell", () => {
    const names = createNames();
    names.created("x", "c_aaaaaa");
    expect(names.get("x")).toEqual({ definedBy: "c_aaaaaa", kind: "var" });
    expect(names.get("y")).toBeUndefined();
  });

  it("attributes every defined name the record has, with its kind", () => {
    const names = createNames();
    names.created("a", "c_aaaaaa");
    const kinds = { a: "const", f: "function" } as const;
    names.attribute(run({ defines: ["a", "f", "gone"], kinds, record: { a: 1, f: 2 } }));
    expect(names.get("a")).toEqual({ definedBy: "c_bbbbbb", kind: "const" });
    expect(names.get("f")).toEqual({ definedBy: "c_bbbbbb", kind: "function" });
    expect(names.get("gone")).toBeUndefined();
  });

  it("keeps the previous kind, else var, when the run names none", () => {
    const names = createNames();
    names.attribute(run({ defines: ["i"], kinds: { i: "import" }, record: { i: 1 } }));
    names.attribute(run({ cell: "c_cccccc", defines: ["i", "w"], record: { i: 2, w: 3 } }));
    expect(names.get("i")).toEqual({ definedBy: "c_cccccc", kind: "import" });
    expect(names.get("w")).toEqual({ definedBy: "c_cccccc", kind: "var" });
  });
});

describe("createNames after a run that ended in error", () => {
  it("claims only the names it created or changed", () => {
    const names = createNames();
    const first = { same: 1, changed: 1 };
    names.attribute(run({ cell: "c_aaaaaa", defines: ["same", "changed"], record: first }));
    const before = new Map(Object.entries(first));
    const defines = ["same", "changed", "fresh"];
    const kinds = { same: "let", changed: "let", fresh: "let" } as const;
    const record = { same: 1, changed: 2, fresh: 3 };
    names.attribute(run({ ok: false, defines, kinds, before, record }));
    expect(names.get("same")).toEqual({ definedBy: "c_aaaaaa", kind: "var" });
    expect(names.get("changed")).toEqual({ definedBy: "c_bbbbbb", kind: "let" });
    expect(names.get("fresh")).toEqual({ definedBy: "c_bbbbbb", kind: "let" });
  });
});
