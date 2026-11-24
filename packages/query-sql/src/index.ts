// Public API of @jsnb/query-sql: SQL over records with DuckDB behind SqlEngine (11-query §3); the page's engine.
export type {
  Column,
  ExportFormat,
  ExportOptions,
  Json,
  LoadProgress,
  QueryOptions,
  RegisterOptions,
  Result,
  ResultColumn,
  Row,
  Schema,
  SqlEngine,
  SqlEngineOptions,
  TableSource,
} from "./engine.ts";
export { defaultMaxRows, defaultTimeoutMs } from "./engine.ts";
export type { QueryErrorReason } from "./errors.ts";
export { QueryError } from "./errors.ts";
export { createSqlEngine } from "./page.ts";
