// Checks what callers pass in (names, limits, formats, options) before anything reaches DuckDB.
import type { ExportFormat, SqlEngineOptions } from "./engine.ts";
import { defaultMaxRows, defaultTimeoutMs } from "./engine.ts";
import type { Outcome } from "./errors.ts";
import { QueryError, messages } from "./errors.ts";

/** Names starting with this are the engine's own (load files, staging tables, exports). */
export const internalPrefix = "__nimbo_";

const maxNameLength = 128;

const invalid = (message: string): Outcome<never> => ({
  ok: false,
  error: new QueryError("input", message),
});

/** A table or alias name: 1 to 128 characters, no NUL, not one of the engine's internal names. */
export function checkName(kind: "table" | "alias", name: unknown): Outcome<string> {
  const valid =
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= maxNameLength &&
    !name.includes("\0") &&
    !name.startsWith(internalPrefix);
  return valid ? { ok: true, value: name } : invalid(messages.name(kind, name));
}

/** A row limit: a whole number, 0 or more; `undefined` takes the engine's `maxRows`. */
export function checkLimit(limit: unknown, fallback: number): Outcome<number> {
  if (limit === undefined) return { ok: true, value: fallback };
  const valid = typeof limit === "number" && Number.isSafeInteger(limit) && limit >= 0;
  return valid ? { ok: true, value: limit } : invalid(messages.limit(limit));
}

/** An export format: "csv" or "ndjson". */
export function checkFormat(format: unknown): Outcome<ExportFormat> {
  return format === "csv" || format === "ndjson"
    ? { ok: true, value: format }
    : invalid(messages.format(format));
}

export type Settings = { readonly timeoutMs: number; readonly maxRows: number };

/** The engine options with their defaults: `timeoutMs` > 0 (Infinity allowed), `maxRows` a whole number ≥ 0. */
export function checkOptions(options: SqlEngineOptions): Outcome<Settings> {
  const timeoutMs: unknown = options.timeoutMs ?? defaultTimeoutMs;
  if (typeof timeoutMs !== "number" || !(timeoutMs > 0)) {
    return invalid(messages.option("timeoutMs", timeoutMs));
  }
  const maxRows = checkLimit(options.maxRows, defaultMaxRows);
  if (!maxRows.ok) return invalid(messages.option("maxRows", options.maxRows));
  return { ok: true, value: { timeoutMs, maxRows: maxRows.value } };
}
