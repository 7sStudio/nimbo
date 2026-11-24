// The engine contract (closes O11): query-json's and query-sql's real engines are output-view's injected engine types,
// checked by the compiler with `satisfies`, and each answers one query through the viewer's interface in Node. Disposing
// the host's Node engines leaves no temporary folder behind (09 §1.6).
import { existsSync } from "node:fs";

import { createSqlEngine } from "@jsnb/query-sql";
import { createNodeSqlEngine } from "@jsnb/query-sql/node";
import type {
  ChipCompiler,
  SelectQueryEngine,
  SqlQueryEngine,
  TransformQueryEngine,
} from "@jsnb/output-view/model";
import {
  chipsToJsonPath,
  createJqEngine,
  createJsonPathEngine,
  jsonPathToChips,
} from "@jsnb/query-json";
import { afterAll, describe, expect, it } from "vitest";

import { createNodeEngines } from "./engines.node.js";

// Type-level: each real engine, as its package creates it, is the interface output-view declares for it.
createJsonPathEngine satisfies () => SelectQueryEngine;
createJqEngine satisfies () => TransformQueryEngine;
createSqlEngine satisfies () => SqlQueryEngine;
createNodeSqlEngine satisfies (options: { directory: string }) => SqlQueryEngine;
({ toJsonPath: chipsToJsonPath, fromJsonPath: jsonPathToChips }) satisfies ChipCompiler;

const engines = createNodeEngines();
afterAll(() => engines.dispose());

describe("the real engines through output-view's interface", () => {
  it("JSONPath selects normalized paths", async () => {
    await engines.jsonpath.load();
    const compiled = engines.jsonpath.compile("$[?@.n > 1]");
    if (!compiled.ok) throw new Error(compiled.error.message);
    expect(await compiled.value.select([{ n: 1 }, { n: 2 }])).toEqual({
      ok: true,
      value: { paths: ["$[1]"] },
    });
  });

  it("jq transforms a value", async () => {
    await engines.jq.load();
    const compiled = engines.jq.compile(".[] | .n");
    if (!compiled.ok) throw new Error(compiled.error.message);
    expect(await compiled.value.transform([{ n: 1 }, { n: 2 }])).toEqual({
      ok: true,
      value: { value: [1, 2], count: 2 },
    });
  });

  it("chips compile to JSONPath and read back", () => {
    const query = engines.chips.toJsonPath([{ key: "n", op: ">", value: 1 }]);
    expect(query).toBe("$[?@.n > 1]");
    expect(engines.chips.fromJsonPath(query)).toEqual({
      at: "$",
      chips: [{ key: "n", op: ">", value: 1 }],
    });
  });

  it("SQL registers rows as t and queries them", async () => {
    await engines.sql.load();
    const schema = await engines.sql.register("t", [{ n: 1 }, { n: 2 }], { alias: "events" });
    expect([schema.table, schema.alias, schema.rowCount]).toEqual(["t", "events", 2]);
    const result = await engines.sql.query("SELECT sum(n) AS total FROM events");
    expect(result.rows).toEqual([{ total: 3 }]);
  });
});

describe("the host's Node engines", () => {
  it("remove their temporary folder on dispose, after DuckDB wrote to it", async () => {
    const own = createNodeEngines();
    await own.sql.register("t", [{ n: 1 }]);
    await own.sql.exportAll("SELECT * FROM t", { format: "csv" });
    expect(existsSync(own.directory)).toBe(true);
    await own.dispose();
    expect(existsSync(own.directory)).toBe(false);
  });
});
