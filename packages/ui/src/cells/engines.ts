// The output viewers' query engines (11-query §3, §4), built once at start as tests/output-view's host
// composes them: query-json's JSONPath and jq engines and its Filter chips compiler, and query-sql's page engine. Each
// starts its worker, or downloads DuckDB-WASM, on first use, so the page's first load carries none of them.
import {
  chipsToJsonPath,
  createJqEngine,
  createJsonPathEngine,
  jsonPathToChips,
} from "@jsnb/query-json";
import { createSqlEngine } from "@jsnb/query-sql";

/** The engines output-view takes (its QueryEngines), every one present. */
export function createPageEngines() {
  return {
    jsonpath: createJsonPathEngine(),
    jq: createJqEngine(),
    sql: createSqlEngine(),
    chips: { toJsonPath: chipsToJsonPath, fromJsonPath: jsonPathToChips },
  };
}
