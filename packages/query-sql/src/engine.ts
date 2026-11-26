// The SqlEngine contract the hosts use, its value types and the settings' defaults.
import type { Table } from "apache-arrow";

/** A JSON value, the shape every row value takes once it leaves DuckDB. */
export type Json =
  null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

/** One result row, keyed by the (deduplicated) column names. */
export type Row = Readonly<Record<string, Json>>;

/** Download progress of the engine's first load, in bytes. */
export type LoadProgress = { readonly loadedBytes: number; readonly totalBytes: number };

/** `fields`: a STRUCT's members, also through LIST elements and MAP values, so the bar can complete `data.object.amount`. */
export type Column = {
  readonly name: string;
  readonly type: string;
  readonly fields: readonly Column[];
};

/** A registered table as the query bar's autocomplete sees it. */
export type Schema = {
  readonly table: string;
  readonly alias: string | undefined;
  readonly columns: readonly Column[];
  readonly rowCount: number;
};

/** A result column; names are deduplicated (`a`, `a_1`) so every row key is unique. */
export type ResultColumn = { readonly name: string; readonly type: string };

/** The rows of one query, capped at the limit, with the exact total and how long it ran. */
export type Result = {
  readonly columns: readonly ResultColumn[];
  readonly rows: readonly Row[];
  readonly total: number;
  readonly truncated: boolean;
  readonly durationMs: number;
};

/** Rows (JSON values), an Arrow table, or the JSON bytes of an array streamed from GET /outputs/<execution>/<index>.json. */
export type TableSource = readonly unknown[] | Table | Blob;

export type RegisterOptions = { readonly alias?: string; readonly signal?: AbortSignal };
export type QueryOptions = { readonly limit?: number; readonly signal?: AbortSignal };
export type ExportFormat = "csv" | "ndjson";
export type ExportOptions = { readonly format: ExportFormat; readonly signal?: AbortSignal };

/** `timeoutMs` is the `query.timeoutMs` setting, `maxRows` the `query.sqlMaxRows` setting. */
export type SqlEngineOptions = { readonly timeoutMs?: number; readonly maxRows?: number };

export type SqlEngine = {
  /** Loads DuckDB once (later calls share or reuse it); progress reports the download. */
  load(onProgress?: (progress: LoadProgress) => void, signal?: AbortSignal): Promise<void>;
  /** Creates or replaces `table` from the source, plus the alias as a view, and returns its schema. */
  register(table: string, source: TableSource, options?: RegisterOptions): Promise<Schema>;
  /** Runs the SQL as written, returning at most `limit` rows (default `maxRows`) and the exact total. */
  query(sql: string, options?: QueryOptions): Promise<Result>;
  /** The columns (with STRUCT fields) and row count of a table. */
  schema(table: string): Promise<Schema>;
  /** Every row of the SQL's result as CSV with a header or as NDJSON, through DuckDB's COPY. */
  exportAll(sql: string, options: ExportOptions): Promise<Blob>;
  /** Drops the table and its alias view and forgets the registration. */
  drop(table: string): Promise<void>;
  /** Closes the engine: work in flight rejects `closed`, tables are forgotten; a later call loads afresh. */
  dispose(): Promise<void>;
};

/** `query.timeoutMs` default. */
export const defaultTimeoutMs = 5000;

/** `query.sqlMaxRows` default. */
export const defaultMaxRows = 10_000;
