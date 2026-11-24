// The page engine against the parity fixture the Node engine is held to as well (src/node/parity.integration.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SqlEngine } from "./engine.ts";
import { parityCases, parityTables } from "./fixtures/parity.ts";
import { numberCases } from "./fixtures/parity-numbers.ts";
import { timeCases, timeTables } from "./fixtures/parity-time.ts";
import { createSqlEngine } from "./page.ts";

let engine: SqlEngine;
beforeAll(async () => {
  engine = createSqlEngine();
  await engine.load();
});
afterAll(() => engine.dispose());

describe("parity with the Node engine", () => {
  for (const parity of [...parityCases, ...timeCases, ...numberCases]) {
    it(parity.title, async () => {
      for (const table of [...parityTables, ...timeTables]) {
        const options = table.alias === undefined ? {} : { alias: table.alias };
        await engine.register(table.name, table.rows, options);
      }
      const result = await engine.query(
        parity.sql,
        parity.limit === undefined ? {} : { limit: parity.limit },
      );
      expect(result.columns.map((column) => column.name)).toEqual(parity.columns);
      const types = parity.types ?? {};
      const named = result.columns.filter((column) => column.name in types);
      expect(Object.fromEntries(named.map((column) => [column.name, column.type]))).toEqual(types);
      expect(result.rows).toEqual(parity.rows);
      expect(result.total).toBe(parity.total);
    });
  }
});
