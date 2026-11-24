// An Arrow record batch stream as the grid's result (11-query §3): rows converted until the limit, the batches
// after it only counted, so `total` is exact and `truncated` says whether rows were left out.
import type { RecordBatch, Schema, Table } from "apache-arrow";

import type { Deadline } from "./abort.ts";
import { dedupe, fieldTypeName } from "./columns.ts";
import type { Json, Result, Row } from "./engine.ts";
import type { Origin } from "./opaque.ts";
import { columnToJson } from "./values.ts";

/** The stream of one query: its schema and a pull for the next batch (`undefined` at the end). */
export type Batches = {
  readonly schema: Schema;
  next(): Promise<RecordBatch | undefined>;
};

/** The rows of one batch, the first `count` of them, keyed by `names`. */
function batchRows(
  batch: RecordBatch,
  names: readonly string[],
  count: number,
  origin: Origin,
): Row[] {
  // Never batch.slice(): arrow-js slices offset nested buffers twice; the readers index the full Data instead.
  const columns = names.map((_, index) => {
    const data = batch.data.children[index];
    return data === undefined ? [] : columnToJson(data, count, batch.schema.fields[index], origin);
  });
  const rows: Row[] = [];
  for (let row = 0; row < count; row += 1) {
    rows.push(
      Object.fromEntries(
        names.map((name, index): [string, Json] => [name, columns[index]?.[row] ?? null]),
      ),
    );
  }
  return rows;
}

/**
 * Reads every batch: converts rows up to `limit`, counts the rest; stops with the deadline's error when it fires.
 * `origin` says whether DuckDB-WASM made the batches or they are a caller's table.
 */
export async function collect(
  batches: Batches,
  limit: number,
  stop: Deadline,
  origin: Origin,
): Promise<Omit<Result, "durationMs">> {
  const fields = batches.schema.fields;
  const names = dedupe(fields.map((field) => field.name));
  const rows: Row[] = [];
  let total = 0;
  for (let batch = await batches.next(); batch !== undefined; batch = await batches.next()) {
    if (stop.signal.aborted) throw stop.error();
    const take = Math.min(batch.numRows, limit - rows.length);
    if (take > 0) rows.push(...batchRows(batch, names, take, origin));
    total += batch.numRows;
  }
  if (stop.signal.aborted) throw stop.error();
  const columns = fields.map((field, index) => ({
    name: names[index] ?? field.name,
    type: fieldTypeName(field),
  }));
  return { columns, rows, total, truncated: total > rows.length };
}

/** Every row of a caller's Arrow table, read like a result's (a FixedSizeBinary stays bytes). */
export function tableRows(table: Table): Row[] {
  const names = dedupe(table.schema.fields.map((field) => field.name));
  return table.batches.flatMap((batch) => batchRows(batch, names, batch.numRows, "table"));
}
