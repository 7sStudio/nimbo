// Tests resolveSelection for every Selection mode of 03-api §4.2.
import { describe, expect, it } from "vitest";

import { emptyAnalysis } from "../model/analysis.js";
import { buildGraph } from "./graph.js";
import { resolveSelection } from "./selection.js";

const graph = buildGraph([
  { id: "c_000001", type: "server", analysis: { ...emptyAnalysis(), defines: ["a"] } },
  { id: "c_000002", type: "server", analysis: { ...emptyAnalysis(), defines: ["b"], uses: ["a"] } },
  { id: "c_000003", type: "markdown", analysis: emptyAnalysis() },
  { id: "c_000004", type: "server", analysis: { ...emptyAnalysis(), uses: ["b"] } },
]);
const order = ["c_000001", "c_000002", "c_000003", "c_000004"];
const context = { order, graph, stale: { c_000001: false, c_000002: true, c_000004: true } };

describe("resolveSelection", () => {
  it("returns every cell for all and the named ones in notebook order", () => {
    expect(resolveSelection(context, "all")).toEqual(order);
    expect(resolveSelection(context, { cells: ["c_000004", "c_000001", "c_999999"] })).toEqual([
      "c_000001",
      "c_000004",
    ]);
  });

  it("returns the cells above, exclusive", () => {
    expect(resolveSelection(context, { above: "c_000003" })).toEqual(["c_000001", "c_000002"]);
    expect(resolveSelection(context, { above: "c_000001" })).toEqual([]);
    expect(resolveSelection(context, { above: "c_999999" })).toEqual([]);
  });

  it("returns the cell then its transitive dependents", () => {
    expect(resolveSelection(context, { withDependents: "c_000001" })).toEqual([
      "c_000001",
      "c_000002",
      "c_000004",
    ]);
  });

  it("returns the stale cells", () => {
    expect(resolveSelection(context, { stale: true })).toEqual(["c_000002", "c_000004"]);
  });
});
