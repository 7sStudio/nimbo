// The daemon's Database on @duckdb/node-api (`cell.outputQuery { mode: "sql" }`, `nimbo outputs --sql`): the same
// statements and Json rules as the page; the engine's files live only in its directory.
import { mkdir, readFile, rm } from "node:fs/promises";

import type { Deadline } from "../abort.ts";
import type { Database, OpenOptions } from "../database.ts";
import type { ExportFormat, Result } from "../engine.ts";
import { QueryError, messages } from "../errors.ts";
import { copyPrefix, exportExtension, exportType, statements } from "../sql.ts";
import type { NodeInstance } from "./instance.ts";
import { openInstance } from "./instance.ts";
import { collectChunks } from "./result.ts";
import { drain, stream, withConnection } from "./run.ts";
import { createTable, dropTable, internalPath, readSchema } from "./tables.ts";

async function runQuery(
  node: NodeInstance,
  sql: string,
  limit: number,
  stop: Deadline,
): Promise<Result> {
  const started = performance.now();
  const result = await withConnection(node, (connection) =>
    stream(node, connection, { sql, stop }, (chunks) => collectChunks(chunks, limit, stop)),
  );
  return { ...result, durationMs: Math.round(performance.now() - started) };
}

async function exportRows(
  node: NodeInstance,
  directory: string,
  request: { readonly sql: string; readonly format: ExportFormat; readonly stop: Deadline },
): Promise<Blob> {
  const { sql, format, stop } = request;
  const path = internalPath(directory, exportExtension(format));
  const copy = { sql: statements.copy(sql, path, format), stop, offset: copyPrefix.length };
  try {
    await withConnection(node, (connection) =>
      stream(node, connection, copy, (chunks) => drain(chunks, stop)),
    );
    return new Blob([await readFile(path)], { type: exportType(format) });
  } finally {
    await rm(path, { force: true });
  }
}

/** Creates `directory` when missing and opens an in-memory DuckDB; `onProgress` is never called (nothing downloads). */
export async function openNodeDatabase(directory: string, options: OpenOptions): Promise<Database> {
  await mkdir(directory, { recursive: true });
  const node = await openInstance(directory);
  if (options.signal.aborted) {
    const cancelled = new QueryError("cancelled", messages.cancelled());
    node.close(cancelled);
    throw cancelled;
  }
  return {
    alive: () => node.isAlive(),
    register: (spec, stop) => createTable(node, directory, spec, stop),
    query: (sql, limit, stop) => runQuery(node, sql, limit, stop),
    schema: (table, alias) => readSchema(node, table, alias),
    exportAll: (sql, format, stop) => exportRows(node, directory, { sql, format, stop }),
    drop: (table, alias) => dropTable(node, table, alias),
    close: (error) => {
      node.close(error);
    },
  };
}
