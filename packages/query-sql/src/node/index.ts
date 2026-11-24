// Public API of @jsnb/query-sql/node: the daemon's SQL engine on @duckdb/node-api, the same SqlEngine as the page's.
export type { NodeSqlEngineOptions } from "./engine.ts";
export { createNodeSqlEngine } from "./engine.ts";
export { findDuckdb, useDuckdbFolder } from "./binding.ts";
export type {
  Column,
  ExportFormat,
  ExportOptions,
  Json,
  QueryOptions,
  RegisterOptions,
  Result,
  ResultColumn,
  Row,
  Schema,
  SqlEngine,
  TableSource,
} from "../engine.ts";
export type { QueryErrorReason } from "../errors.ts";
export { QueryError } from "../errors.ts";
