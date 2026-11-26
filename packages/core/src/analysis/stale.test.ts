// Tests every staleness transition: edit, delete, run and kernel restart, each returning a new map.
import { describe, expect, it } from "vitest";

import { emptyAnalysis } from "../model/analysis.js";
import type { GraphInput } from "./graph.js";
import { buildGraph } from "./graph.js";
import {
  afterDelete,
  afterEdit,
  afterKernelRestart,
  afterRun,
  afterRunEnded,
  staleReason,
} from "./stale.js";

type Facts = { readonly defines: string[]; readonly uses: string[] };
const cell = (id: string, type: GraphInput["type"], { defines, uses }: Facts): GraphInput => ({
  id,
  type,
  analysis: { ...emptyAnalysis(), defines, uses, exports: defines },
});

const graph = buildGraph([
  cell("c_000001", "server", { defines: ["a"], uses: [] }),
  cell("c_000002", "server", { defines: ["b"], uses: ["a"] }),
  cell("c_000003", "client", { defines: ["c"], uses: ["b"] }),
  cell("c_000004", "client", { defines: ["d"], uses: ["c"] }),
  cell("c_000005", "server", { defines: ["e"], uses: [] }),
]);
const none = {
  c_000001: false,
  c_000002: false,
  c_000003: false,
  c_000004: false,
  c_000005: false,
};

describe("afterEdit", () => {
  it("marks the transitive dependents and leaves the cell and the map alone", () => {
    const next = afterEdit(graph, none, "c_000001");
    expect(next).toEqual({ ...none, c_000002: true, c_000003: true, c_000004: true });
    expect(none.c_000002).toBe(false);
  });

  it("marks the cell itself when it ran other code, never a cell that did not run", () => {
    expect(afterEdit(graph, none, "c_000005", true)).toEqual({ ...none, c_000005: true });
    expect(afterEdit(graph, none, "c_000005", false)).toEqual(none);
  });
});

describe("afterDelete", () => {
  it("marks the dependents and drops the cell", () => {
    expect(afterDelete(graph, none, "c_000002")).toEqual({
      c_000001: false,
      c_000003: true,
      c_000004: true,
      c_000005: false,
    });
  });
});

describe("afterRun", () => {
  it("clears the cell and marks its dependents", () => {
    const stale = { ...none, c_000002: true };
    expect(afterRun(graph, stale, "c_000002")).toEqual({ ...none, c_000003: true, c_000004: true });
  });
});

describe("afterRunEnded", () => {
  it("marks the cell when its code changed while it ran, else leaves the flags as they are", () => {
    const stale = { ...none, c_000003: true };
    expect(afterRunEnded(stale, "c_000002", false)).toBe(stale);
    expect(afterRunEnded(none, "c_000002", true)).toEqual({ ...none, c_000002: true });
  });
});

describe("staleReason", () => {
  const byId = new Map(graph.cells.map((each) => [each.id, each]));
  const numberOf = (id: string) => graph.cells.findIndex((each) => each.id === id) + 1;
  const reason = (id: string, edited: boolean) =>
    staleReason(byId.get(id), (other) => byId.get(other), edited, numberOf);

  it("says the cell's own edit first, else the name that changed upstream and where", () => {
    expect(reason("c_000003", true)).toBe("edited since its last run");
    expect(reason("c_000003", false)).toBe("b changed in cell 2");
    expect(reason("c_000001", false)).toBe("");
  });
});

describe("afterKernelRestart", () => {
  it("clears server cells and marks the client cells that use a server export", () => {
    const stale = { ...none, c_000001: true, c_000005: true };
    expect(afterKernelRestart(graph, stale)).toEqual({ ...none, c_000003: true });
  });
});
