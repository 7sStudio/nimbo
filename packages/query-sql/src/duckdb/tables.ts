// Tables in DuckDB-WASM: one from rows (registerFileText), a Blob (registerFileHandle, so the page never holds the
// full value as a JavaScript array) or an Arrow table (this copy's through a staging table, another's as rows), its
// alias view, drop, schema.
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";

import type { Deadline } from "../abort.ts";
import { toColumn } from "../columns.ts";
import type { TableSpec } from "../database.ts";
import type { Schema } from "../engine.ts";
import type { Source } from "../sources.ts";
import { classify } from "../sources.ts";
import { statements } from "../sql.ts";
import { internalName, registerSource, releaseFile } from "./files.ts";
import type { Instance } from "./instance.ts";
import { drain, execute, inTransaction, send, unbounded, withConnection } from "./run.ts";

type Session = { readonly instance: Instance; readonly connection: AsyncDuckDBConnection };

async function fromSource(
  { instance, connection }: Session,
  table: string,
  source: Source,
  stop: Deadline,
) {
  if (source.kind === "arrow" && source.native) {
    const stage = internalName("stage");
    await instance.track(() =>
      connection.insertArrowTable(source.table, { name: stage, create: true }),
    );
    try {
      await execute(instance, connection, statements.fromTable(table, stage), stop);
    } finally {
      if (instance.isAlive()) await execute(instance, connection, statements.dropTable(stage));
    }
    return;
  }
  const file = `${internalName("load")}.json`;
  try {
    const unsigned = await registerSource(instance, file, table, source);
    await execute(instance, connection, statements.fromJson(table, file, unsigned), stop);
  } finally {
    await releaseFile(instance, file);
  }
}

/**
 * Creates or replaces the table and its alias view in one transaction: a concurrent query sees the old or the new
 * table, and a failure anywhere (an alias DuckDB refuses, a cancel) leaves DuckDB as it was.
 */
export function createTable(instance: Instance, spec: TableSpec, stop: Deadline): Promise<void> {
  const source = classify(spec.table, spec.source);
  if (!source.ok) return Promise.reject(source.error);
  return withConnection(instance, (connection) =>
    inTransaction(instance, connection, async () => {
      await fromSource({ instance, connection }, spec.table, source.value, stop);
      for (const view of spec.stale) {
        await execute(instance, connection, statements.dropView(view));
      }
      if (spec.alias !== undefined) {
        await execute(instance, connection, statements.alias(spec.alias, spec.table));
      }
    }),
  );
}

/** Drops the alias view and the table, when they exist. */
export function dropTable(
  instance: Instance,
  table: string,
  alias: string | undefined,
): Promise<void> {
  return withConnection(instance, async (connection) => {
    if (alias !== undefined) await execute(instance, connection, statements.dropView(alias));
    await execute(instance, connection, statements.dropTable(table));
  });
}

/** The columns (from the Arrow schema of an empty select) and the row count of a table or view. */
export function readSchema(
  instance: Instance,
  table: string,
  alias: string | undefined,
): Promise<Schema> {
  return withConnection(instance, async (connection) => {
    const sample = { sql: statements.sample(table), stop: unbounded() };
    const columns = await send(instance, connection, sample, async (batches) => {
      await drain(batches, sample.stop);
      return batches.schema.fields.map(toColumn);
    });
    const counted = { sql: statements.count(table), stop: unbounded() };
    const rowCount = await send(instance, connection, counted, async (batches) => {
      let count = 0;
      for (let batch = await batches.next(); batch !== undefined; batch = await batches.next()) {
        const value: unknown = batch.getChildAt(0)?.get(0);
        if (typeof value === "bigint" || typeof value === "number") count = Number(value);
      }
      return count;
    });
    return { table, alias, columns, rowCount };
  });
}
