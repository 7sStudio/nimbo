// At run time the page holds no DuckDB and no Arrow until the engine loads (11-query §3): the resource timing
// entries name neither after index.ts is imported and an engine created, and name both once it loaded.
import { describe, expect, it } from "vitest";

import { createSqlEngine } from "./index.ts";

const named = (pattern: RegExp) =>
  performance
    .getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((name) => pattern.test(name));

describe("lazy load", () => {
  it("fetches DuckDB and Arrow only when the engine loads", async () => {
    performance.setResourceTimingBufferSize(10_000);
    const engine = createSqlEngine();
    expect(named(/duckdb|arrow/iu)).toEqual([]);
    await engine.load();
    expect(named(/duckdb/iu).length).toBeGreaterThan(0);
    expect(named(/arrow/iu).length).toBeGreaterThan(0);
    await engine.dispose();
  });
});
