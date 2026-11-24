// The contract both DuckDB backends implement for the lifecycle (DuckDB-WASM in the page, node-api on the daemon).
import type { Deadline } from "./abort.ts";
import type { ExportFormat, LoadProgress, Result, Schema, TableSource } from "./engine.ts";
import type { QueryError } from "./errors.ts";

/** One table to create or replace, its alias view, and the alias views the change leaves stale (to drop). */
export type TableSpec = {
  readonly table: string;
  readonly source: TableSource;
  readonly alias: string | undefined;
  readonly stale: readonly string[];
};

/** A loaded DuckDB with the operations the lifecycle drives; every method rejects with QueryError only. */
export type Database = {
  /** False once the instance died (worker crash) or was closed. */
  alive(): boolean;
  register(spec: TableSpec, stop: Deadline): Promise<void>;
  query(sql: string, limit: number, stop: Deadline): Promise<Result>;
  schema(table: string, alias: string | undefined): Promise<Schema>;
  exportAll(sql: string, format: ExportFormat, stop: Deadline): Promise<Blob>;
  drop(table: string, alias: string | undefined): Promise<void>;
  /** Ends the instance; work in flight rejects with `error`. */
  close(error: QueryError): void;
};

export type OpenOptions = {
  readonly onProgress: (progress: LoadProgress) => void;
  readonly signal: AbortSignal;
  /** Called when the instance dies on its own (a worker crash), so the next call opens a new one. */
  readonly onDeath: () => void;
};

/** Loads a backend and opens one DuckDB instance; rejects with QueryError (`load`, `cancelled`). */
export type Opener = (options: OpenOptions) => Promise<Database>;
