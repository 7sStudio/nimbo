// DuckDB's json extension, which DuckDB-WASM fetches from extensions.duckdb.org the first time a statement needs it.
// Left to autoload inside a statement, a failed fetch traps the WebAssembly module and kills the worker, which only
// says the engine stopped; loaded on its own first, it fails as a plain error the page can name, and a later call
// fetches it again.
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";

import { QueryError, messages } from "../errors.ts";
import type { Instance } from "./instance.ts";

const loaded = new WeakSet<Instance>();

/** Whether `error` is the browser failing to fetch an extension (offline, or the request blocked). */
const isFetchFailure = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === "NetworkError" || /duckdb_extension|Failed to fetch/u.test(error.message));

/** Loads the json extension once per instance; a fetch that fails is QueryError("load") saying so. */
export async function loadJson(
  instance: Instance,
  connection: AsyncDuckDBConnection,
): Promise<void> {
  if (loaded.has(instance)) return;
  try {
    await instance.track(() => connection.query("LOAD json"));
  } catch (error) {
    if (error instanceof QueryError) throw error;
    if (isFetchFailure(error)) throw new QueryError("load", messages.network(), { cause: error });
    throw new QueryError("query", error instanceof Error ? error.message : String(error), {
      cause: error,
    });
  }
  loaded.add(instance);
}
