// Tests the Variables panel's shadow line source: each name a server cell exports, with its first exporter's number.
import { describe, expect, it } from "vitest";

import { exportersOf } from "./exporters.js";

describe("exportersOf", () => {
  it("numbers each exported name by the first server cell that exports it, skipping other cells", () => {
    const cells = [
      { id: "c_aaaaaa", type: "markdown" },
      { id: "c_bbbbbb", type: "server" },
      { id: "c_cccccc", type: "client" },
      { id: "c_dddddd", type: "server" },
    ];
    const exports: Readonly<Record<string, readonly string[]>> = {
      c_bbbbbb: ["seats", "greet"],
      c_cccccc: ["box"],
      c_dddddd: ["seats", "plan"],
    };
    const found = exportersOf(cells, (cell) => exports[cell]);
    expect([...found]).toEqual([
      ["seats", 2],
      ["greet", 2],
      ["plan", 4],
    ]);
  });

  it("answers nothing for cells the graph does not know yet", () => {
    expect(exportersOf([{ id: "c_bbbbbb", type: "server" }], () => undefined).size).toBe(0);
  });
});
