// The DuckDB-WASM assets as URLs the bundler serves: the exception-handling (eh) build only, which every browser the
// page supports runs (WebAssembly exceptions are in current Chromium, Firefox and Safari), so the mvp fallback is not
// shipped.
import type { DuckDBBundle } from "@duckdb/duckdb-wasm";
import ehWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import ehModule from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";

export const bundle: DuckDBBundle = {
  mainModule: ehModule,
  mainWorker: ehWorker,
  pthreadWorker: null,
};

/** The build the page loads. */
export const pickBundle = (): Promise<DuckDBBundle> => Promise.resolve(bundle);
