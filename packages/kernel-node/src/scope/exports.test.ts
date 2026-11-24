// Tests the export table: registration, aliases, clearing per cell, the listed order and the local-name check.
import { describe, expect, it } from "vitest";

import { createExports } from "./exports.js";

describe("createExports", () => {
  it("registers names with their local names and cells, in order", () => {
    const exports = createExports();
    exports.register("a", "a", "c_aaaaaa");
    exports.register("c", "b", "c_bbbbbb");
    expect(exports.list()).toEqual([
      { name: "a", cell: "c_aaaaaa" },
      { name: "c", cell: "c_bbbbbb" },
    ]);
    expect(exports.resolve("c")).toEqual({ local: "b", cell: "c_bbbbbb" });
    expect(exports.resolve("b")).toBeUndefined();
  });

  it("knows which locals are exported", () => {
    const exports = createExports();
    exports.register("c", "b", "c_bbbbbb");
    expect([exports.isExported("b"), exports.isExported("c")]).toEqual([true, false]);
  });

  it("clears one cell's exports and keeps a name another cell re-exported", () => {
    const exports = createExports();
    exports.register("a", "a", "c_aaaaaa");
    exports.register("shared", "shared", "c_aaaaaa");
    exports.register("shared", "shared", "c_bbbbbb");
    exports.clear("c_aaaaaa");
    expect(exports.list()).toEqual([{ name: "shared", cell: "c_bbbbbb" }]);
  });
});
