// output-view's choice of query modes (model/engines.ts) over the real engines: which modes they
// allow, and which one the bar opens in.
import { availableModes, defaultMode, queryModes } from "@jsnb/output-view/model";
import { afterAll, describe, expect, it } from "vitest";

import { createNodeEngines } from "./engines.node.js";

const engines = createNodeEngines();
afterAll(() => engines.dispose());

describe("availableModes", () => {
  it("allows Filter with JSONPath and the chip compiler, each other mode with its engine", () => {
    expect(availableModes(engines)).toEqual(queryModes);
    expect(availableModes({ jsonpath: engines.jsonpath })).toEqual(["jsonpath"]);
    expect(availableModes({ chips: engines.chips, sql: engines.sql })).toEqual(["sql"]);
  });
});

describe("defaultMode", () => {
  it("opens SQL on a grid and JSONPath on a tree, else the first available", () => {
    expect([defaultMode(engines, "grid"), defaultMode(engines, "tree")]).toEqual([
      "sql",
      "jsonpath",
    ]);
    expect(defaultMode({ jq: engines.jq }, "grid")).toBe("jq");
  });
});
