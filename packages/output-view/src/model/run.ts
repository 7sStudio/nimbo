// Runs the query bar through the injected engines: loads an engine only when its mode is first used and
// turns every engine answer, rejection included, into the bar's result or error; nothing here throws.
import type { Path, QueryMode } from "@jsnb/core";

import type { Chip } from "./chips.js";
import type { EngineError, EngineResult, QueryEngines, SqlSchema } from "./engines.js";
import { parsePath } from "./path.js";
import type { QueryFailure, QueryResult } from "./query.js";

export type RunOutcome =
  | { readonly ok: true; readonly value: QueryResult }
  | { readonly ok: false; readonly error: QueryFailure };

/** One run: the mode and its text (or Filter chips under `at`), the value, and the run's signal and timeout. */
export type QueryRun = {
  readonly mode: QueryMode;
  readonly text: string;
  readonly chips?: readonly Chip[];
  readonly at?: string;
  readonly json: unknown;
  readonly limit?: number;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
};

const failure = (
  kind: string,
  message: string,
  position?: number,
): { ok: false; error: QueryFailure } => ({
  ok: false,
  error: position === undefined ? { kind, message } : { kind, message, position },
});

const unavailable = (mode: QueryMode): { ok: false; error: QueryFailure } =>
  failure(
    "unavailable",
    `The ${mode === "jsonpath" ? "JSONPath" : mode} engine is not available here.`,
  );

const fromEngine = (error: EngineError): { ok: false; error: QueryFailure } =>
  failure(error.kind ?? "runtime", error.message, error.position);

/** A rejection as a failure: query-sql rejects with a QueryError carrying `position` and `data.reason`; anything else
 * thrown keeps its text. */
export function rejected(cause: unknown): { ok: false; error: QueryFailure } {
  const message = cause instanceof Error ? cause.message : String(cause);
  const position: unknown =
    typeof cause === "object" && cause !== null ? Reflect.get(cause, "position") : undefined;
  const data: unknown =
    typeof cause === "object" && cause !== null ? Reflect.get(cause, "data") : undefined;
  const reason: unknown =
    typeof data === "object" && data !== null ? Reflect.get(data, "reason") : undefined;
  return failure(
    typeof reason === "string" ? reason : "runtime",
    message,
    typeof position === "number" ? position : undefined,
  );
}

/** Loads the engine behind a mode, the first time the user picks it; SQL reports download progress. */
export async function loadMode(
  engines: QueryEngines,
  mode: QueryMode,
  onProgress?: (progress: { readonly loadedBytes: number; readonly totalBytes: number }) => void,
  signal?: AbortSignal,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: QueryFailure }> {
  const engine = mode === "jq" ? engines.jq : mode === "sql" ? engines.sql : engines.jsonpath;
  if (engine === undefined || (mode === "filter" && engines.chips === undefined))
    return unavailable(mode);
  try {
    await (mode === "sql" ? engines.sql?.load(onProgress, signal) : engine.load());
    return { ok: true };
  } catch (cause) {
    // A failed download is the bar's error line, not a crash; the user can pick the mode again to retry.
    return rejected(cause);
  }
}

const options = (run: QueryRun): { signal?: AbortSignal; timeoutMs?: number } => ({
  ...(run.signal === undefined ? {} : { signal: run.signal }),
  ...(run.timeoutMs === undefined ? {} : { timeoutMs: run.timeoutMs }),
});

/** Normalized paths from the engine as segments; one that does not parse is dropped (engines return valid ones). */
export const pathsOf = (normalized: readonly string[]): Path[] =>
  normalized.flatMap((text) => {
    const parsed = parsePath(text);
    return parsed.ok ? [parsed.value] : [];
  });

async function select(engines: QueryEngines, query: string, run: QueryRun): Promise<RunOutcome> {
  const compiled = engines.jsonpath?.compile(query);
  if (compiled === undefined) return unavailable(run.mode);
  if (!compiled.ok) return fromEngine(compiled.error);
  const answer = await compiled.value.select(run.json, options(run));
  return answer.ok
    ? { ok: true, value: { kind: "select", query, paths: pathsOf(answer.value.paths) } }
    : fromEngine(answer.error);
}

async function transform(engines: QueryEngines, run: QueryRun): Promise<RunOutcome> {
  const compiled = engines.jq?.compile(run.text);
  if (compiled === undefined) return unavailable(run.mode);
  if (!compiled.ok) return fromEngine(compiled.error);
  const answer: EngineResult<{ readonly value: unknown; readonly count: number }> =
    await compiled.value.transform(run.json, options(run));
  return answer.ok
    ? {
        ok: true,
        value: { kind: "transform", value: answer.value.value, count: answer.value.count },
      }
    : fromEngine(answer.error);
}

async function sql(engines: QueryEngines, run: QueryRun): Promise<RunOutcome> {
  if (engines.sql === undefined) return unavailable(run.mode);
  try {
    const rows = await engines.sql.query(run.text, {
      ...(run.limit === undefined ? {} : { limit: run.limit }),
      ...options(run),
    });
    return { ok: true, value: { kind: "rows", ...rows } };
  } catch (cause) {
    // DuckDB refused the SQL, timed out or was cancelled: the bar underlines `position` and shows the message.
    return rejected(cause);
  }
}

/** Runs one query; Filter compiles its chips to JSONPath with the host's compiler first and runs that. */
export async function runQuery(engines: QueryEngines, run: QueryRun): Promise<RunOutcome> {
  if (run.mode === "jq") return transform(engines, run);
  if (run.mode === "sql") return sql(engines, run);
  if (run.mode === "jsonpath") return select(engines, run.text, run);
  if (engines.chips === undefined) return unavailable(run.mode);
  return select(engines, engines.chips.toJsonPath(run.chips ?? [], run.at), run);
}

/** Registers the full rows as table `t` (and the binding name as an alias) before SQL queries run on them. */
export async function registerRows(
  engines: QueryEngines,
  source: readonly unknown[] | Blob,
  alias?: string,
  signal?: AbortSignal,
): Promise<
  | { readonly ok: true; readonly value: SqlSchema }
  | { readonly ok: false; readonly error: QueryFailure }
> {
  if (engines.sql === undefined) return unavailable("sql");
  try {
    const schema = await engines.sql.register("t", source, {
      ...(alias === undefined ? {} : { alias }),
      ...(signal === undefined ? {} : { signal }),
    });
    return { ok: true, value: schema };
  } catch (cause) {
    // The rows could not be loaded (input, load, cancelled): the bar shows why instead of the grid.
    return rejected(cause);
  }
}
