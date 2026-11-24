// The page's SQL engine: DuckDB-WASM in a Web Worker behind the shared lifecycle, loaded only when first used.
import type { Opener } from "./database.ts";
import type { SqlEngine, SqlEngineOptions } from "./engine.ts";
import { createLifecycle } from "./lifecycle.ts";

/**
 * Creates the page's SQL engine. It holds one DuckDB instance, so the host creates one engine per page and calls
 * `dispose()` on notebook close (11-query §3); DuckDB downloads on the first `load()` or first use, never with the page.
 */
export function createSqlEngine(options: SqlEngineOptions = {}): SqlEngine {
  const open: Opener = async (openOptions) => {
    const { openDatabase } = await import("./duckdb/database.ts");
    return openDatabase(openOptions);
  };
  return createLifecycle({ open, restarts: true }, options);
}
