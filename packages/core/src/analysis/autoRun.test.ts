// Tests the auto-run order over real graphs: dependency order with notebook-order ties, cycles found and left last.
import { describe, expect, it } from "vitest";

import { emptyAnalysis } from "../model/analysis.js";
import { autoRunOrder, cyclicCells, nextAutoRun } from "./autoRun.js";
import type { GraphInput } from "./graph.js";
import { buildGraph } from "./graph.js";

const server = (id: string, defines: string[], uses: string[] = []): GraphInput => ({
  id,
  type: "server",
  analysis: { ...emptyAnalysis(), defines, uses },
});

describe("auto-run order", () => {
  // d uses b and c, both from a: a diamond, with c above b to check the order is by dependency first
  const diamond = buildGraph([
    server("c_d", ["d"], ["b", "c"]),
    server("c_a", ["a"]),
    server("c_c", ["c"], ["a"]),
    server("c_b", ["b"], ["a"]),
  ]);

  it("puts dependencies first and breaks ties in notebook order", () => {
    expect(autoRunOrder(diamond, new Set(["c_d", "c_b", "c_c"]))).toEqual(["c_c", "c_b", "c_d"]);
    expect(nextAutoRun(diamond, new Set(["c_d", "c_b", "c_c"]))).toBe("c_c");
    expect(nextAutoRun(diamond, new Set(["c_d"]))).toBe("c_d");
    expect(nextAutoRun(diamond, new Set())).toBeUndefined();
  });

  it("finds the cells on a cycle and runs nothing of them", () => {
    const graph = buildGraph([
      server("c_1", ["x"], ["y"]),
      server("c_2", ["y"], ["x"]),
      server("c_3", ["z"], ["y"]),
      server("c_4", ["w"]),
    ]);
    expect([...cyclicCells(graph, ["c_1", "c_2", "c_3", "c_4"])].sort()).toEqual(["c_1", "c_2"]);
    expect(cyclicCells(graph, ["c_1", "c_3"]).size).toBe(0);
    const pending = new Set(["c_1", "c_2", "c_3"]);
    expect(nextAutoRun(graph, pending)).toBeUndefined();
    expect(autoRunOrder(graph, pending)).toEqual(["c_1", "c_2", "c_3"]);
  });
});
