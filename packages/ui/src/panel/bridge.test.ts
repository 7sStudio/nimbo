// The Bridge group's rows from the graph: each export once, its cell, and the client cells that use it.
import { describe, expect, it } from "vitest";

import { bridgeOf, signatureTail } from "./bridge.js";

const entry = (exports: string[], uses: string[] = []) => ({
  defines: exports,
  uses,
  exports,
  dependsOn: [],
});

const cells = [
  { id: "md", type: "markdown" },
  {
    id: "s1",
    type: "server",
    source: "export async function createIntent(amount,\n  currency) {}\nexport const refund = 1;",
  },
  { id: "s2", type: "server" },
  { id: "c1", type: "client" },
  { id: "c2", type: "client" },
];

describe("bridgeOf", () => {
  it("lists each export with its cell and the client cells that call it", () => {
    const graph = new Map([
      ["s1", entry(["createIntent", "refund"])],
      ["s2", entry(["createIntent"], ["refund"])],
      ["c1", entry([], ["createIntent"])],
      ["c2", entry([], ["createIntent", "other"])],
    ]);
    expect(bridgeOf(cells, graph)).toEqual([
      {
        name: "createIntent",
        signature: "async (amount, currency)",
        cell: { id: "s1", number: 2 },
        callers: [4, 5],
      },
      { name: "refund", signature: "", cell: { id: "s1", number: 2 }, callers: [] },
    ]);
  });
});

describe("bridgeOf's signatures", () => {
  it("reads the parameters of an arrow function or a function assigned to the name", () => {
    const arrow = [{ id: "s", type: "server", source: "export const f = async (a, { b }) => a" }];
    const plain = [{ id: "s", type: "server", source: "export const g = function (x) {}" }];
    expect(bridgeOf(arrow, new Map([["s", entry(["f"])]]))[0]?.signature).toBe("async (a, { b })");
    expect(bridgeOf(plain, new Map([["s", entry(["g"])]]))[0]?.signature).toBe("(x)");
  });

  it("ignores what a client cell exports and cells the graph does not know", () => {
    expect(bridgeOf(cells, new Map([["c1", entry(["mine"])]]))).toEqual([]);
    expect(bridgeOf([], new Map())).toEqual([]);
  });
});

describe("signatureTail", () => {
  it("drops what names the export, whatever form the hover gives", () => {
    expect(signatureTail("function twice(n: number): Promise<number>", "twice")).toBe(
      "(n: number): Promise<number>",
    );
    expect(signatureTail("const twice: (n: number) => number", "twice")).toBe(
      "(n: number) => number",
    );
    expect(signatureTail("async function* $pages(at: string)", "$pages")).toBe("(at: string)");
    expect(signatureTail("class Store", "Store")).toBe("class Store");
  });
});
