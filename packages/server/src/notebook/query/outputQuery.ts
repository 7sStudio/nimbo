// cell.outputQuery: a query against the full value of one `value` output (retained, or the
// output's json when it was never cut) in one of four modes: Filter chips compiled to JSONPath and JSONPath select
// paths (answered with the selected nodes too, each capped like cell.outputValue's children), jq transforms (its
// outputs capped the same way), SQL runs on the value's plain rows as table `t`. JSONPath and jq run on the wire
// form, as the page's query bar does. A query that runs past query.timeoutMs answers `timedOut` with an empty result.
import type { Chip, QueryMode } from "@jsnb/core";
import { InvalidParams } from "@jsnb/core";
import type { Chip as EngineChip, QueryError as JsonQueryError } from "@jsnb/query-json";
import { chipsToJsonPath, parsePath } from "@jsnb/query-json";

import { nodeAt, sliceOf } from "../session/runs/slice.js";
import type { JsonEngines } from "./engines.js";
import { invalidQuery, OutputQueryFailed } from "./errors.js";

export type QueryAnswer = {
  readonly result: {
    readonly paths?: string[];
    readonly value?: unknown;
    readonly columns?: { readonly name: string; readonly type: string }[];
    readonly rows?: unknown[];
  };
  readonly total: number;
  readonly truncated: boolean;
  readonly timedOut?: boolean;
};

export type JsonQuery = {
  readonly mode: QueryMode;
  readonly query: string | readonly Chip[];
  /** Filter mode: the JSONPath of the node whose children the chips filter (default `$`). */
  readonly at?: string | undefined;
  readonly root: unknown;
  /** The key `root` is held under in the engines when it is a retained value; the others go with their query. */
  readonly key?: string | undefined;
  readonly limit: number;
  readonly timeoutMs: number;
  readonly maxBytes: number;
};

/** An engine's run over the queried value: held under its key (sent to the worker once) when it has one. */
function over<T>(
  engine: { hold(key: string, json: unknown): void },
  request: JsonQuery,
  runs: { readonly own: () => Promise<T>; readonly held: (key: string) => Promise<T> },
): Promise<T> {
  if (request.key === undefined) return runs.own();
  engine.hold(request.key, request.root); // the same value again keeps what the worker holds
  return runs.held(request.key);
}

export const timedOutAnswer: QueryAnswer = {
  result: {},
  total: 0,
  truncated: true,
  timedOut: true,
};

/** A JSON engine's failure as the call's: the query's own mistakes are INVALID_PARAMS, a timeout a result. */
function failed(mode: QueryMode, error: JsonQueryError): QueryAnswer {
  if (error.kind === "timeout") return timedOutAnswer;
  if (error.kind === "syntax" || error.kind === "runtime")
    throw invalidQuery(error.message, error.position);
  throw new OutputQueryFailed({ mode, reason: error.kind }, error.message);
}

const chipIssue = (at: number, message: string): InvalidParams =>
  new InvalidParams({ issues: [{ path: ["query", at, "value"], message }] });

/** One chip as query-json compiles it: text operators take a string, comparisons a value, `exists` none. */
function engineChip(chip: Chip, at: number): EngineChip {
  const { key, op, value } = chip;
  if (op === "exists") return { key, op };
  if (op === "contains" || op === "startsWith" || op === "matches") {
    if (typeof value !== "string")
      throw chipIssue(at, `${op} compares text: give the value as a string`);
    return { key, op, value };
  }
  if (value === undefined) throw chipIssue(at, `${op} compares with a value: give one`);
  return { key, op, value };
}

const issue = (path: string, message: string): InvalidParams =>
  new InvalidParams({ issues: [{ path: [path], message }] });

/** Filter mode's node: a singular JSONPath (`$`, `$.data`, `$['data'][0]`), only in Filter mode. */
function filteredNode(mode: QueryMode, at: string | undefined): string {
  if (at === undefined) return "$";
  if (mode !== "filter")
    throw issue("at", `${mode} mode takes no \`at\`: name the node in the query`);
  const path = parsePath(at);
  if (!path.ok) throw issue("at", `${at} is not the JSONPath of one node: ${path.error.message}`);
  return at;
}

/** The query text of a mode: Filter's chips compiled to JSONPath on the children of `at`, a string for the others. */
export function queryText(mode: QueryMode, query: string | readonly Chip[], at?: string): string {
  const chips = mode === "filter";
  if (chips !== Array.isArray(query)) {
    const message = chips
      ? "Filter mode takes chips: an array of { key, op, value }"
      : `${mode} mode takes a string`;
    throw issue("query", message);
  }
  const node = filteredNode(mode, at);
  return typeof query === "string" ? query : chipsToJsonPath(query.map(engineChip), node);
}

async function select(
  engines: JsonEngines,
  request: JsonQuery,
  text: string,
): Promise<QueryAnswer> {
  const engine = await engines.jsonpath();
  const compiled = engine.compile(text);
  if (!compiled.ok) return failed(request.mode, compiled.error);
  const run = { timeoutMs: request.timeoutMs };
  const answer = await over(engine, request, {
    own: () => compiled.value.select(request.root, run),
    held: (key) => compiled.value.selectHeld(key, run),
  });
  if (!answer.ok) return failed(request.mode, answer.error);
  const { paths } = answer.value;
  const kept = paths.slice(0, request.limit);
  const nodes = kept.map((path) => {
    const parsed = parsePath(path);
    return parsed.ok ? nodeAt(request.root, parsed.value)?.node : undefined;
  });
  const slice = sliceOf(nodes, { offset: 0, limit: nodes.length }, request.maxBytes);
  const result = { paths: [...kept], value: slice.json };
  return { result, total: paths.length, truncated: paths.length > kept.length || slice.truncated };
}

async function transform(
  engines: JsonEngines,
  request: JsonQuery,
  text: string,
): Promise<QueryAnswer> {
  const engine = await engines.jq();
  const compiled = engine.compile(text);
  if (!compiled.ok) return failed(request.mode, compiled.error);
  const run = { timeoutMs: request.timeoutMs };
  const answer = await over(engine, request, {
    own: () => compiled.value.transform(request.root, run),
    held: (key) => compiled.value.transformHeld(key, run),
  });
  if (!answer.ok) return failed(request.mode, answer.error);
  const { value, count } = answer.value;
  const many = count > 1 && Array.isArray(value);
  const shown: unknown = many ? value.slice(0, request.limit) : value;
  const slice = sliceOf(shown, { offset: 0, limit: Number.POSITIVE_INFINITY }, request.maxBytes);
  return {
    result: { value: slice.json },
    total: count,
    truncated: (many && count > request.limit) || slice.truncated,
  };
}

/** A Filter, JSONPath or jq query. */
export function jsonQuery(engines: JsonEngines, request: JsonQuery): Promise<QueryAnswer> {
  const text = queryText(request.mode, request.query, request.at);
  return request.mode === "jq" ? transform(engines, request, text) : select(engines, request, text);
}
