// The page's query engines as main.ts builds them for the output viewers, in Chromium with
// the real engines: query-json's JSONPath and jq in their Web Workers, query-sql's DuckDB-WASM, and the Filter chips
// compiler; each is output-view's injected type and answers one query.
import type { QueryEngines } from "@jsnb/output-view/model";
import { afterAll, describe, expect, it } from "vitest";

import { createPageEngines } from "./engines.js";

createPageEngines satisfies () => QueryEngines;

const engines = createPageEngines();
afterAll(async () => {
  await Promise.all([engines.jsonpath.dispose(), engines.jq.dispose(), engines.sql.dispose()]);
});

describe("the page's engines", () => {
  it("JSONPath selects in its worker", async () => {
    await engines.jsonpath.load();
    const compiled = engines.jsonpath.compile("$[?@.n > 1]");
    if (!compiled.ok) throw new Error(compiled.error.message);
    expect(await compiled.value.select([{ n: 1 }, { n: 2 }])).toEqual({
      ok: true,
      value: { paths: ["$[1]"] },
    });
  });

  it("jq transforms in its worker", async () => {
    await engines.jq.load();
    const compiled = engines.jq.compile(".[] | .n");
    if (!compiled.ok) throw new Error(compiled.error.message);
    expect(await compiled.value.transform([{ n: 1 }, { n: 2 }])).toEqual({
      ok: true,
      value: { value: [1, 2], count: 2 },
    });
  });

  it("DuckDB-WASM queries rows registered as a table", async () => {
    await engines.sql.load();
    await engines.sql.register("t", [{ n: 1 }, { n: 2 }]);
    expect((await engines.sql.query("SELECT sum(n) AS total FROM t")).rows).toEqual([{ total: 3 }]);
  });

  it("compiles Filter chips to JSONPath and back", () => {
    const query = engines.chips.toJsonPath([{ key: "n", op: ">", value: 1 }]);
    expect(query).toBe("$[?@.n > 1]");
    expect(engines.chips.fromJsonPath(query)).toEqual({
      at: "$",
      chips: [{ key: "n", op: ">", value: 1 }],
    });
  });
});
