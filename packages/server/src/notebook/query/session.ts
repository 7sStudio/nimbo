// cell.outputQuery on a session (03-api §4.3): the full value of the queried run's `value` output (the cell's last run,
// or `execution` when it names it), then the mode's engine; SQL on the session's own DuckDB tables, the rest on the
// daemon's JSON engines, where a retained value is held under its key (sent to their worker once). The
// answer carries the mode and how long the whole query took.
import type { Chip, QueryMode } from "@jsnb/core";
import { QueryError } from "@jsnb/query-sql/node";

import { timerMs } from "../../kernel/timers.js";
import type { SessionContext } from "../session/context.js";
import { fullValueOf, queriedRun } from "../session/runs/outputs.js";
import type { JsonEngines } from "./engines.js";
import { heldKey } from "./engines.js";
import { duckdbStatus } from "../../files/duckdb/duckdb.js";
import { invalidQuery, OutputQueryFailed, SqlEngineMissing } from "./errors.js";
import type { QueryAnswer } from "./outputQuery.js";
import { jsonQuery, queryText, timedOutAnswer } from "./outputQuery.js";
import { toPlain } from "./plain.js";
import type { SqlTables } from "./sql.js";

export type OutputQueryRequest = {
  readonly cell: string;
  readonly execution?: string | undefined;
  readonly index: number;
  readonly mode: QueryMode;
  readonly query: string | readonly Chip[];
  readonly at?: string | undefined;
  readonly limit: number;
};

export type OutputQueryAnswer = QueryAnswer & {
  readonly mode: QueryMode;
  readonly durationMs: number;
};

export type QueryParts = { readonly engines: JsonEngines; readonly sql: SqlTables };

/**
 * DuckDB's message for a table other than `t`: its guess is one of DuckDB's own catalog tables (`pg_enum`), which
 * misleads, so the message names the one table there is instead.
 */
function sqlMessage(message: string): string {
  const missing = /Table with name (\S+) does not exist!/u.exec(message);
  if (missing === null) return message;
  return `Table with name ${missing[1] ?? ""} does not exist: the value is table t (select * from t; a list of plain values is its column value).`;
}

/** query-sql's rejection as the call's: DuckDB refusing the SQL is INVALID_PARAMS, the rest OutputQueryFailed. */
function sqlFailure(error: unknown): unknown {
  if (!(error instanceof QueryError)) return error;
  if (error.data.reason === "query") return invalidQuery(sqlMessage(error.message), error.position);
  if (error.data.reason === "missing") {
    const { version, folder } = duckdbStatus();
    return new SqlEngineMissing({ version, folder });
  }
  return new OutputQueryFailed({ mode: "sql", reason: error.data.reason }, error.message);
}

/** The rows `t` holds: the value's plain JSON, an array's items or the one value (as the page registers them). */
const rowsOf = (root: unknown) => (): readonly unknown[] => {
  const plain = toPlain(root);
  return Array.isArray(plain) ? plain : [plain];
};

/** The value SQL mode loads as `t`: its key (`<execution>:<index>`) and its wire form. */
type SqlValue = { readonly key: string; readonly root: unknown };

async function sqlQuery(
  context: SessionContext,
  parts: QueryParts,
  request: OutputQueryRequest,
  value: SqlValue,
) {
  const settings = context.settings();
  const sql = queryText("sql", request.query, request.at);
  const limit = Math.min(request.limit, settings["query.sqlMaxRows"]);
  const timeoutMs = timerMs(settings["query.timeoutMs"]);
  const rows = rowsOf(value.root);
  const answer = await parts.sql
    .query({ key: value.key, rows, sql, limit, timeoutMs })
    .catch((error: unknown) => {
      throw sqlFailure(error);
    });
  if (!answer.ok) return timedOutAnswer;
  const { columns, rows: found, total, truncated } = answer.value;
  return { result: { columns: [...columns], rows: [...found] }, total, truncated };
}

/** cell.outputQuery. */
export async function outputQuery(
  context: SessionContext,
  parts: QueryParts,
  request: OutputQueryRequest,
): Promise<OutputQueryAnswer> {
  const started = performance.now();
  await context.runs.retained.settled(); // the budget applied to every value kept before this query
  const run = queriedRun(context, request.cell, request.execution);
  const root = fullValueOf(context, run, request.index);
  const retained = context.runs.retained.get(run.id, request.index) !== undefined;
  const settings = context.settings();
  const answer =
    request.mode === "sql"
      ? await sqlQuery(context, parts, request, { key: `${run.id}:${String(request.index)}`, root })
      : await jsonQuery(parts.engines, {
          ...{ mode: request.mode, query: request.query, at: request.at },
          ...{ root, limit: request.limit },
          key: retained ? heldKey(context.holdKey, run.id, request.index) : undefined,
          ...{
            timeoutMs: timerMs(settings["query.timeoutMs"]),
            maxBytes: settings["outputs.maxValueBytes"],
          },
        });
  return { mode: request.mode, ...answer, durationMs: Math.round(performance.now() - started) };
}
