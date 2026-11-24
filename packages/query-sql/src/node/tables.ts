// Tables in the daemon's DuckDB: each source becomes a JSON file in the engine's directory (node-api cannot read
// JSON from memory), loaded with the same read_json_auto as the page and removed after; alias views, drop, schema.
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Deadline } from "../abort.ts";
import type { TableSpec } from "../database.ts";
import type { Schema } from "../engine.ts";
import { internalPrefix } from "../input.ts";
import type { Source } from "../sources.ts";
import { classify, encodeSource } from "../sources.ts";
import { statements } from "../sql.ts";
import type { NodeInstance } from "./instance.ts";
import { toColumn } from "./result.ts";
import { execute, inTransaction, stream, unbounded, withConnection } from "./run.ts";

/** A path for one of the engine's files in `directory`: `__nimbo_<random>.<extension>`. */
export const internalPath = (directory: string, extension: string): string =>
  join(directory, `${internalPrefix}${randomUUID()}.${extension}`);

/**
 * The JSON bytes of a source (rows stringified, a Blob as it is, an Arrow table as its rows, integers exact) and the
 * columns the load casts back to UBIGINT.
 */
async function sourceBytes(table: string, source: Source) {
  if (source.kind === "blob") {
    return { bytes: new Uint8Array(await source.blob.arrayBuffer()), unsigned: [] };
  }
  const encoded = encodeSource(table, source);
  return { bytes: encoded.json, unsigned: encoded.unsigned };
}

/**
 * Creates or replaces the table and its alias view in one transaction: a concurrent query sees the old or the new
 * table, and a failure anywhere (an alias DuckDB refuses, a cancel) leaves DuckDB as it was.
 */
export async function createTable(
  node: NodeInstance,
  directory: string,
  spec: TableSpec,
  stop: Deadline,
): Promise<void> {
  const source = classify(spec.table, spec.source);
  if (!source.ok) throw source.error;
  const path = internalPath(directory, "json");
  try {
    const { bytes, unsigned } = await sourceBytes(spec.table, source.value);
    await writeFile(path, bytes);
    await withConnection(node, (connection) =>
      inTransaction(node, connection, async () => {
        await execute(node, connection, statements.fromJson(spec.table, path, unsigned), stop);
        for (const view of spec.stale) await execute(node, connection, statements.dropView(view));
        if (spec.alias !== undefined) {
          await execute(node, connection, statements.alias(spec.alias, spec.table));
        }
      }),
    );
  } finally {
    await rm(path, { force: true });
  }
}

/** Drops the alias view and the table, when they exist. */
export function dropTable(
  node: NodeInstance,
  table: string,
  alias: string | undefined,
): Promise<void> {
  return withConnection(node, async (connection) => {
    if (alias !== undefined) await execute(node, connection, statements.dropView(alias));
    await execute(node, connection, statements.dropTable(table));
  });
}

/** The columns and the row count of a table or view. */
export function readSchema(
  node: NodeInstance,
  table: string,
  alias: string | undefined,
): Promise<Schema> {
  return withConnection(node, async (connection) => {
    const sample = { sql: statements.sample(table), stop: unbounded() };
    const columns = await stream(node, connection, sample, ({ result }) => {
      const types = result.columnTypes();
      return Promise.resolve(
        result.columnNames().flatMap((name, index) => {
          const type = types[index];
          return type === undefined ? [] : [toColumn(name, type)];
        }),
      );
    });
    const counted = { sql: statements.count(table), stop: unbounded() };
    const rowCount = await stream(node, connection, counted, async (chunks) => {
      const value = (await chunks.next())?.getColumnValues(0)[0];
      return typeof value === "bigint" || typeof value === "number" ? Number(value) : 0;
    });
    return { table, alias, columns, rowCount };
  });
}
