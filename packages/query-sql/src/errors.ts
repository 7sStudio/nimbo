// QueryError, the one error every SqlEngine method rejects with, its reasons and the message template of each.

/** Why a call failed; `query` is DuckDB rejecting the SQL itself, the rest are the engine's own failures. */
export type QueryErrorReason =
  "query" | "cancelled" | "timeout" | "load" | "crashed" | "input" | "closed" | "missing";

/** The result of a step that is expected to fail sometimes (return inside, throw at the boundary). */
export type Outcome<T, E = QueryError> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

type QueryErrorOptions = { readonly position?: number | undefined; readonly cause?: unknown };

/** The error of both SQL engines; `position` is a 0-based offset into the SQL for the bar's underline. */
export class QueryError extends Error {
  override readonly name = "QueryError";
  readonly position: number | undefined;
  readonly data: { readonly reason: QueryErrorReason };

  constructor(reason: QueryErrorReason, message: string, options: QueryErrorOptions = {}) {
    super(message, "cause" in options ? { cause: options.cause } : undefined);
    this.position = options.position;
    this.data = { reason };
  }
}

const show = (value: unknown): string =>
  typeof value === "string" ? JSON.stringify(value) : String(value);

/** One template per failure: each names the thing and says what to do. */
export const messages = {
  cancelled: () =>
    "The SQL query was cancelled before it finished. Run it again to see its result.",
  timeout: (timeoutMs: number) =>
    `The SQL query ran longer than ${String(timeoutMs)} ms and was stopped. Narrow it with WHERE or LIMIT, or raise query.timeoutMs.`,
  load: (detail: string) =>
    `The SQL engine could not be loaded (${detail}). Check the connection and try again; the next call retries the load.`,
  missing: () =>
    "The SQL engine's native DuckDB binding (@duckdb/node-api) is not installed. Install it, then run the query again.",
  crashed: () =>
    "The SQL engine stopped unexpectedly. It restarts on the next query and restores the registered tables.",
  closed: () =>
    "The SQL engine was closed while this call was running. Run it again to start a new engine.",
  name: (kind: "table" | "alias", name: unknown) =>
    `The ${kind} name ${show(name)} is not valid. Use 1 to 128 characters, no NUL character and no __nimbo_ prefix.`,
  taken: (name: string, owner: string) =>
    `The name "${name}" is already used by the table "${owner}". Pick another name, or drop "${owner}" first.`,
  limit: (limit: unknown) =>
    `The row limit ${show(limit)} is not valid. Use a whole number of rows, 0 or more.`,
  rows: (table: string, detail: string) =>
    `The rows for table "${table}" cannot be encoded as JSON (${detail}). Convert BigInt values to numbers or strings and remove circular references.`,
  source: (table: string) =>
    `The source for table "${table}" is not an array of rows, an Arrow table or a Blob. Pass one of those three.`,
  arrow: (table: string, detail: string) =>
    `The Arrow table for table "${table}" has a column the SQL engine cannot read (${detail}). Cast or drop that column, build the table with the engine's apache-arrow, or pass its rows.`,
  format: (format: unknown) =>
    `The export format ${show(format)} is not valid. Use "csv" or "ndjson".`,
  enumeration: () =>
    "The page's SQL engine cannot read ENUM values: DuckDB-WASM streams them without their labels. Cast the column to text in the query, for example status::VARCHAR.",
  opaque: (type: string) =>
    `The SQL engine cannot read DuckDB's ${type.toUpperCase()} values: they arrive as bytes with no Arrow type. Cast the column to text in the query, for example value::VARCHAR.`,
  directory: (directory: unknown) =>
    `The SQL engine's directory ${show(directory)} is not valid. Pass the folder it may write its files to, such as .jsnb/cache/sql.`,
  option: (key: string, value: unknown) =>
    `The engine option ${key} = ${show(value)} is not valid. Use a positive number of milliseconds for timeoutMs and a whole number of rows for maxRows.`,
} as const;

/** The error for a stopped call: the caller's signal fired (`cancelled`) or the deadline passed (`timeout`). */
export function stopError(stop: "cancelled" | "timeout", timeoutMs: number): QueryError {
  return stop === "timeout"
    ? new QueryError("timeout", messages.timeout(timeoutMs))
    : new QueryError("cancelled", messages.cancelled());
}

/** The error that ends a load: the cause's own text, kept as the cause. */
export function loadError(cause: unknown): QueryError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new QueryError("load", messages.load(detail), { cause });
}

/** Any failure as a QueryError, so every public method rejects with one class (throw at the boundary). */
export function asQueryError(error: unknown): QueryError {
  if (error instanceof QueryError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new QueryError("query", message, { cause: error });
}
