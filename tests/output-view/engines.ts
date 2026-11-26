// The query engines a host injects into OutputView, built once at app start as the app does:
// query-json's JSONPath and jq engines and its Filter chips compiler, and query-sql's SQL engine.
// This is the composition a host copies (ui needs exactly it); the host's tests run the viewer with these.
import type { QueryEngines } from "@jsnb/output-view/model";
import {
  chipsToJsonPath,
  createJqEngine,
  createJsonPathEngine,
  jsonPathToChips,
} from "@jsnb/query-json";
import type { SqlEngine } from "@jsnb/query-sql";

/** Every engine output-view takes, and one call that frees them all (the workers, the DuckDB instance). */
export type HostEngines = Required<QueryEngines> & { readonly dispose: () => Promise<void> };

/**
 * The engines over `sql`: the page's DuckDB-WASM engine in a browser (`createSqlEngine` of @jsnb/query-sql), the
 * daemon's engine in Node (`createNodeSqlEngine` of @jsnb/query-sql/node). JSONPath and jq start their workers on
 * first use, and SQL downloads DuckDB on first use, so building them costs nothing until a query runs.
 */
export function createHostEngines(sql: SqlEngine): HostEngines {
  const jsonpath = createJsonPathEngine();
  const jq = createJqEngine();
  return {
    jsonpath,
    jq,
    sql,
    chips: { toJsonPath: chipsToJsonPath, fromJsonPath: jsonPathToChips },
    dispose: async () => {
      await Promise.all([jsonpath.dispose(), jq.dispose(), sql.dispose()]);
    },
  };
}
