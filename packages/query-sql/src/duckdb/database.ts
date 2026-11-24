// The page's Database on DuckDB-WASM, the entry of the lazy chunk the lifecycle imports on first use (never part
// of the page bundle, 11-query §3).
import type { Deadline } from "../abort.ts";
import type { Database, OpenOptions } from "../database.ts";
import type { ExportFormat, Result } from "../engine.ts";
import { collect } from "../result.ts";
import { copyPrefix, exportExtension, exportType, statements } from "../sql.ts";
import { internalName, releaseFile } from "./files.ts";
import type { Instance } from "./instance.ts";
import { startInstance } from "./instance.ts";
import { drain, send, withConnection } from "./run.ts";
import { createTable, dropTable, readSchema } from "./tables.ts";

async function runQuery(
  instance: Instance,
  sql: string,
  limit: number,
  stop: Deadline,
): Promise<Result> {
  const started = performance.now();
  const result = await withConnection(instance, (connection) =>
    send(instance, connection, { sql, stop }, (batches) => collect(batches, limit, stop, "duckdb")),
  );
  return { ...result, durationMs: Math.round(performance.now() - started) };
}

async function exportRows(
  instance: Instance,
  sql: string,
  format: ExportFormat,
  stop: Deadline,
): Promise<Blob> {
  const file = `${internalName("export")}.${exportExtension(format)}`;
  const copy = { sql: statements.copy(sql, file, format), stop, offset: copyPrefix.length };
  try {
    await withConnection(instance, (connection) =>
      send(instance, connection, copy, (batches) => drain(batches, stop)),
    );
    const bytes = await instance.track(() => instance.db.copyFileToBuffer(file));
    // A view on the worker's transferred buffer, copied only when it is not a plain ArrayBuffer.
    const owned =
      bytes.buffer instanceof ArrayBuffer
        ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        : bytes.slice();
    return new Blob([owned], { type: exportType(format) });
  } finally {
    await releaseFile(instance, file);
  }
}

/** Starts DuckDB-WASM in a worker and opens one in-memory database for the lifecycle. */
export async function openDatabase(options: OpenOptions): Promise<Database> {
  const instance = await startInstance(options);
  return {
    alive: () => instance.isAlive(),
    register: (spec, stop) => createTable(instance, spec, stop),
    query: (sql, limit, stop) => runQuery(instance, sql, limit, stop),
    schema: (table, alias) => readSchema(instance, table, alias),
    exportAll: (sql, format, stop) => exportRows(instance, sql, format, stop),
    drop: (table, alias) => dropTable(instance, table, alias),
    close: (error) => {
      instance.kill(error);
    },
  };
}
