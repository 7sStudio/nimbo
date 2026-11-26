// The json extension DuckDB-WASM fetches the first time a table is read, when the fetch fails: the register says the
// engine needs the network and could not reach it, the engine keeps running, and the next call fetches it again.
// The fetch is made to fail by pointing DuckDB's extension repository at a port nothing listens on.
import { describe, expect, it } from "vitest";

import { messages } from "./errors.ts";
import type { Watch } from "./fixtures/workers.ts";
import { watchWorkers } from "./fixtures/workers.ts";
import { createSqlEngine } from "./page.ts";

describe("the json extension's fetch", () => {
  it("fails as load, saying the network is needed, and a retry once it is back works", async () => {
    const watch: Watch = watchWorkers();
    try {
      const engine = createSqlEngine();
      await engine.query("SET custom_extension_repository = 'http://127.0.0.1:9/offline'");
      await expect(engine.register("t", [{ a: 1 }, { a: 2 }])).rejects.toMatchObject({
        message: messages.network(),
        data: { reason: "load" },
      });
      await expect(engine.exportAll("SELECT 1 AS a", { format: "ndjson" })).rejects.toMatchObject({
        data: { reason: "load" },
      });
      await engine.query("RESET custom_extension_repository");
      await engine.register("t", [{ a: 1 }, { a: 2 }]);
      expect((await engine.query("SELECT sum(a)::INTEGER AS s FROM t")).rows).toEqual([{ s: 3 }]);
      expect(watch.started).toHaveLength(1);
      await engine.dispose();
    } finally {
      watch.restore();
    }
  });
});
