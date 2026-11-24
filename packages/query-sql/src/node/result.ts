// node-api results as the engine's Result and Columns: the same JSON rows, capped at the limit with the exact total,
// the same deduplicated names (a, a_1) as the page; type names are DuckDB's own text (`String(type)`).
import type { DuckDBDataChunk, DuckDBType } from "@duckdb/node-api";
import { DuckDBArrayType, DuckDBListType, DuckDBMapType, DuckDBStructType } from "@duckdb/node-api";

import type { Deadline } from "../abort.ts";
import { dedupe } from "../columns.ts";
import type { Column, Json, Result, Row } from "../engine.ts";
import type { Chunks } from "./run.ts";
import { duckValueToJson } from "./values.ts";

/** A STRUCT's members, reached also through LIST, ARRAY elements and MAP values. */
function fieldsOf(type: DuckDBType): Column[] {
  if (type instanceof DuckDBStructType) {
    return type.entryNames.map((name, index) => {
      const entry = type.entryTypes[index];
      return entry === undefined ? { name, type: "", fields: [] } : toColumn(name, entry);
    });
  }
  if (
    type instanceof DuckDBListType ||
    type instanceof DuckDBArrayType ||
    type instanceof DuckDBMapType
  ) {
    return fieldsOf(type.valueType);
  }
  return [];
}

/** One result or table column as a Column. */
export function toColumn(name: string, type: DuckDBType): Column {
  return { name, type: type.toString(), fields: fieldsOf(type) };
}

function chunkRows(chunk: DuckDBDataChunk, names: readonly string[], count: number): Row[] {
  const columns = names.map((_, index) => chunk.getColumnValues(index).slice(0, count));
  const rows: Row[] = [];
  for (let row = 0; row < count; row += 1) {
    rows.push(
      Object.fromEntries(
        names.map((name, index): [string, Json] => [
          name,
          duckValueToJson(columns[index]?.[row] ?? null),
        ]),
      ),
    );
  }
  return rows;
}

/** Reads every chunk: converts rows up to `limit`, counts the rest; stops with the deadline's error when it fires. */
export async function collectChunks(
  chunks: Chunks,
  limit: number,
  stop: Deadline,
): Promise<Omit<Result, "durationMs">> {
  const names = dedupe(chunks.result.columnNames());
  const types = chunks.result.columnTypes();
  const rows: Row[] = [];
  let total = 0;
  for (let chunk = await chunks.next(); chunk !== undefined; chunk = await chunks.next()) {
    if (stop.signal.aborted) throw stop.error();
    const take = Math.min(chunk.rowCount, limit - rows.length);
    if (take > 0) rows.push(...chunkRows(chunk, names, take));
    total += chunk.rowCount;
  }
  if (stop.signal.aborted) throw stop.error();
  const columns = names.map((name, index) => ({ name, type: types[index]?.toString() ?? "" }));
  return { columns, rows, total, truncated: total > rows.length };
}
