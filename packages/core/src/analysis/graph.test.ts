// Tests buildGraph, dependentsOf and dependenciesOf, including the cross-realm edges of 05-bridge §5.
import { describe, expect, it } from "vitest";

import { emptyAnalysis } from "../model/analysis.js";
import type { GraphInput } from "./graph.js";
import { buildGraph, dependenciesOf, dependentsOf } from "./graph.js";

const cell = (
  id: string,
  type: GraphInput["type"],
  facts: Partial<GraphInput["analysis"]> = {},
): GraphInput => ({
  id,
  type,
  analysis: { ...emptyAnalysis(), ...facts },
});

const cells = [
  cell("c_000001", "server", {
    defines: ["stripe", "createIntent"],
    exports: ["createIntent"],
    uses: ["Stripe", "env"],
  }),
  cell("c_000002", "markdown"),
  cell("c_000003", "server", { defines: ["total"], uses: ["stripe", "fetch"] }),
  cell("c_000004", "client", { defines: ["ui"], uses: ["createIntent", "stripe", "document"] }),
  cell("c_000005", "client", { defines: ["x"], uses: ["ui", "total"] }),
];
const graph = buildGraph(cells);

describe("buildGraph", () => {
  it("links server cells through defines and keeps only visible uses", () => {
    expect(graph.cells[2]).toEqual({
      id: "c_000003",
      type: "server",
      defines: ["total"],
      uses: ["stripe"],
      exports: [],
      dependsOn: ["c_000001"],
    });
  });

  it("links client cells to server exports and to client defines, never to non-exported server names", () => {
    expect(graph.cells[3]?.dependsOn).toEqual(["c_000001"]);
    expect(graph.cells[3]?.uses).toEqual(["createIntent"]);
    expect(graph.cells[4]?.dependsOn).toEqual(["c_000004"]);
    expect(graph.cells[4]?.uses).toEqual(["ui"]);
  });

  it("gives markdown cells no names and no edges", () => {
    expect(graph.cells[1]).toEqual({
      id: "c_000002",
      type: "markdown",
      defines: [],
      uses: [],
      exports: [],
      dependsOn: [],
    });
    expect(graph.cells[0]?.dependsOn).toEqual([]);
  });
});

describe("buildGraph across realms", () => {
  it("never links a server cell to a client cell, even when it uses a name the client defines", () => {
    const realms = buildGraph([
      cell("c_000001", "client", { defines: ["ui"] }),
      cell("c_000002", "server", { defines: ["s"], uses: ["ui"] }),
    ]);
    expect(realms.cells[1]?.dependsOn).toEqual([]);
    expect(realms.cells[1]?.uses).toEqual([]);
  });

  it("never links a cell to itself", () => {
    const self = buildGraph([cell("c_000009", "server", { defines: ["a"], uses: ["a"] })]);
    expect(self.cells[0]?.dependsOn).toEqual([]);
  });
});

describe("dependentsOf", () => {
  it("is transitive and in notebook order", () => {
    expect(dependentsOf(graph, "c_000001")).toEqual(["c_000003", "c_000004", "c_000005"]);
    expect(dependentsOf(graph, "c_000005")).toEqual([]);
    expect(dependentsOf(graph, "c_999999")).toEqual([]);
  });

  it("terminates on cycles", () => {
    const loop = buildGraph([
      cell("c_000001", "server", { defines: ["a"], uses: ["b"] }),
      cell("c_000002", "server", { defines: ["b"], uses: ["a"] }),
    ]);
    expect(dependentsOf(loop, "c_000001")).toEqual(["c_000001", "c_000002"]);
  });
});

describe("dependenciesOf", () => {
  it("is transitive", () => {
    expect(dependenciesOf(graph, "c_000005")).toEqual(["c_000001", "c_000004"]);
  });
});
