// The query engines a host injects (11-query §4): structural types that query-json's engines and
// chip compiler and query-sql's SqlEngine satisfy as they are, so output-view never imports them (02-architecture §2).
import type { QueryMode } from "@jsnb/core";

import type { Chip } from "./chips.js";

/** An engine's failure: `kind` names it (syntax, timeout, unavailable…), `position` is the offset to underline. */
export type EngineError = {
  readonly kind?: string;
  readonly message: string;
  readonly position?: number;
};

/** The discriminated union every engine returns (08-code-standards §5). */
export type EngineResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: EngineError };

export type RunOptions = { readonly signal?: AbortSignal; readonly timeoutMs?: number };

/** JSONPath (RFC 9535): results are normalized paths into the value (query-json's SelectEngine). */
export type SelectQueryEngine = {
  readonly id: string;
  readonly mode: "select";
  load(): Promise<void>;
  compile(query: string): EngineResult<{
    select(
      json: unknown,
      options?: RunOptions,
    ): Promise<EngineResult<{ readonly paths: readonly string[] }>>;
  }>;
};

/** jq: a result is a new value, the only output when `count` is 1, else the array of outputs (query-json). */
export type TransformQueryEngine = {
  readonly id: string;
  readonly mode: "transform";
  load(): Promise<void>;
  compile(query: string): EngineResult<{
    transform(
      json: unknown,
      options?: RunOptions,
    ): Promise<EngineResult<{ readonly value: unknown; readonly count: number }>>;
  }>;
};

export type SqlColumn = {
  readonly name: string;
  readonly type: string;
  readonly fields: readonly SqlColumn[];
};

export type SqlSchema = {
  readonly table: string;
  readonly alias: string | undefined;
  readonly columns: readonly SqlColumn[];
  readonly rowCount: number;
};

/** One SQL result: rows capped at the limit, the exact total, and how long the query ran. */
export type SqlRows = {
  readonly columns: readonly { readonly name: string; readonly type: string }[];
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly total: number;
  readonly truncated: boolean;
  readonly durationMs: number;
};

/** DuckDB behind query-sql's SqlEngine; every method rejects with a QueryError on failure. */
export type SqlQueryEngine = {
  load(
    onProgress?: (progress: { readonly loadedBytes: number; readonly totalBytes: number }) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  register(
    table: string,
    source: readonly unknown[] | Blob,
    options?: { readonly alias?: string; readonly signal?: AbortSignal },
  ): Promise<SqlSchema>;
  query(
    sql: string,
    options?: { readonly limit?: number; readonly signal?: AbortSignal },
  ): Promise<SqlRows>;
  exportAll(
    sql: string,
    options: { readonly format: "csv" | "ndjson"; readonly signal?: AbortSignal },
  ): Promise<Blob>;
  drop(table: string): Promise<void>;
};

/** Filter mode's compiler, query-json's chipsToJsonPath and jsonPathToChips. */
export type ChipCompiler = {
  toJsonPath(chips: readonly Chip[], at?: string): string;
  fromJsonPath(query: string): { readonly at: string; readonly chips: readonly Chip[] } | undefined;
};

/** `options.engines` / `:engines`: any may be absent; with none the Query button is hidden (11-query §4). */
export type QueryEngines = {
  readonly jsonpath?: SelectQueryEngine;
  readonly jq?: TransformQueryEngine;
  readonly sql?: SqlQueryEngine;
  readonly chips?: ChipCompiler;
};

/** The modes in the bar's order (11-query §1: Filter · JSONPath · jq · SQL). */
export const queryModes: readonly QueryMode[] = ["filter", "jsonpath", "jq", "sql"];

/** What jq and SQL download on first use (11-query §1), shown beside the mode until it is loaded (11-query §4). */
export const firstUseSizes = { jq: "1.5 MB", sql: "6 MB" } as const;

const firstUseNote = (size: string): string => `loads ${size} on first use`;

/** The same, as the greyed mode's tooltip. */
export const firstUseNotes: Readonly<Partial<Record<QueryMode, string>>> = {
  jq: firstUseNote(firstUseSizes.jq),
  sql: firstUseNote(firstUseSizes.sql),
};

const supports: Readonly<Record<QueryMode, (engines: QueryEngines) => boolean>> = {
  filter: (engines) => engines.jsonpath !== undefined && engines.chips !== undefined,
  jsonpath: (engines) => engines.jsonpath !== undefined,
  jq: (engines) => engines.jq !== undefined,
  sql: (engines) => engines.sql !== undefined,
};

/** The modes the injected engines allow: Filter needs JSONPath and the chip compiler, each other mode its engine. */
export const availableModes = (engines: QueryEngines): readonly QueryMode[] =>
  queryModes.filter((mode) => supports[mode](engines));

/** The mode the bar opens in (11-query §1): SQL on a grid, JSONPath on a tree, else the first available; undefined
 * when no engine was injected (the Query button is then hidden). */
export function defaultMode(engines: QueryEngines, view: "tree" | "grid"): QueryMode | undefined {
  const modes = availableModes(engines);
  const preferred: QueryMode = view === "grid" ? "sql" : "jsonpath";
  return modes.includes(preferred) ? preferred : modes[0];
}
