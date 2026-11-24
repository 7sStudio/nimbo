// createNodeSqlEngine: the daemon's SQL engine on @duckdb/node-api behind the same lifecycle as the page's engine; the
// binding is optional (binding.ts), and an engine without it fails every call with QueryError `missing`.
import { resolve } from "node:path";

import type { Opener } from "../database.ts";
import type { SqlEngine, SqlEngineOptions } from "../engine.ts";
import { QueryError, messages } from "../errors.ts";
import { createLifecycle } from "../lifecycle.ts";
import { findDuckdb } from "./binding.ts";

/** The page engine's options plus `directory`, the only place the engine writes (the daemon's `.jsnb/cache/sql/`). */
export type NodeSqlEngineOptions = SqlEngineOptions & { readonly directory: string };

/**
 * Creates the daemon's SQL engine (`cell.outputQuery { mode: "sql" }`): one in-memory DuckDB, opened on the first
 * `load()` or first use and confined to `directory` (created when missing): sources and exports pass through files
 * there, and no SQL can read or write anywhere else, install an extension or change that.
 */
export function createNodeSqlEngine(options: NodeSqlEngineOptions): SqlEngine {
  const directory: unknown = options.directory;
  if (typeof directory !== "string" || directory.length === 0) {
    throw new QueryError("input", messages.directory(directory));
  }
  const root = resolve(directory);
  const open: Opener = async (openOptions) => {
    // Asked before the engine's modules load: an import that failed on the missing binding would stay failed after
    // the binding is installed, so they are imported only once it can be found.
    if (findDuckdb() === undefined) throw new QueryError("missing", messages.missing());
    const { openNodeDatabase } = await import("./database.ts");
    return openNodeDatabase(root, openOptions);
  };
  // A native crash takes the daemon down with it: no restart, so no source is kept for a replay.
  return createLifecycle({ open, restarts: false }, options);
}
