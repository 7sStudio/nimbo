// The query bar's state as a pure reducer: the mode, its text or chips, loading and running, the result
// or the error, Only matches / All, the pin saved as `meta.outputQuery`, and each mode's history for ↑ and ↓.
import type { CellMeta, Path, QueryMode } from "@jsnb/core";

import type { Chip } from "./chips.js";
import type { SqlRows } from "./engines.js";
import { formatFilter, parseFilter } from "./filter.js";
import { plural, thousands } from "./preview.js";

export type QueryResult =
  | { readonly kind: "select"; readonly query: string; readonly paths: readonly Path[] }
  | { readonly kind: "transform"; readonly value: unknown; readonly count: number }
  | ({ readonly kind: "rows" } & SqlRows);

/** What the bar shows under the input; `position` is the offset to underline. */
export type QueryFailure = {
  readonly kind: string;
  readonly message: string;
  readonly position?: number;
};

export type QueryStatus = "idle" | "loading" | "running" | "done" | "failed";

export type QueryState = {
  readonly mode: QueryMode;
  readonly text: string;
  readonly chips: readonly Chip[];
  readonly status: QueryStatus;
  readonly loaded: ReadonlySet<QueryMode>;
  readonly result: QueryResult | undefined;
  readonly error: QueryFailure | undefined;
  readonly only: boolean;
  readonly pinned: boolean;
  readonly history: Readonly<Partial<Record<QueryMode, readonly string[]>>>;
};

export type QueryAction =
  | { readonly type: "mode"; readonly mode: QueryMode }
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "chips"; readonly chips: readonly Chip[] }
  | { readonly type: "only"; readonly only: boolean }
  | { readonly type: "pin" }
  | { readonly type: "unpin" }
  | { readonly type: "reset" }
  | { readonly type: "loading" }
  | { readonly type: "loaded"; readonly mode: QueryMode }
  | { readonly type: "running" }
  | { readonly type: "succeeded"; readonly result: QueryResult }
  | { readonly type: "failed"; readonly error: QueryFailure };

/** The pinned query of a cell, `meta.outputQuery` (Filter mode stores its Filter text). */
export type QueryPin = NonNullable<CellMeta["outputQuery"]>;

/** Entries kept per mode for ↑ and ↓. */
export const historySize = 50;

/** The count right of the input without SQL's time: `12 nodes`, `2 items`, `6 rows`, `10,000 of 48,120 rows`. */
export function resultCount(result: QueryResult): string {
  if (result.kind === "select") return plural(result.paths.length, "node", "nodes");
  if (result.kind === "transform") return plural(result.count, "item", "items");
  return result.truncated
    ? `${thousands(result.rows.length)} of ${plural(result.total, "row", "rows")}`
    : plural(result.total, "row", "rows");
}

/** SQL's time beside its count, `41 ms`; none for JSONPath, Filter and jq, which do not report one. */
export const resultTime = (result: QueryResult): string | undefined =>
  result.kind === "rows" ? `${String(Math.round(result.durationMs))} ms` : undefined;

/** The count right of the input: `12 nodes`, `2 items`, `6 rows in 41 ms`, `10,000 of 48,120 rows in 41 ms`. */
export function resultLabel(result: QueryResult): string {
  const time = resultTime(result);
  return time === undefined ? resultCount(result) : `${resultCount(result)} in ${time}`;
}

/** A closed bar in `mode`, nothing run yet. */
export const initialQuery = (mode: QueryMode): QueryState => ({
  mode,
  text: "",
  chips: [],
  status: "idle",
  loaded: new Set(),
  result: undefined,
  error: undefined,
  only: true,
  pinned: false,
  history: {},
});

/** The text a run sends: the Filter text in Filter mode, else what the input holds. */
export const queryText = (state: QueryState): string =>
  state.mode === "filter" ? formatFilter(state.chips) : state.text;

const cleared = (state: QueryState): QueryState => ({
  ...state,
  status: "idle",
  result: undefined,
  error: undefined,
});

function remember(state: QueryState): QueryState["history"] {
  const text = queryText(state);
  const past = (state.history[state.mode] ?? []).filter((entry) => entry !== text);
  return { ...state.history, [state.mode]: [text, ...past].slice(0, historySize) };
}

function edit(state: QueryState, action: QueryAction): QueryState {
  switch (action.type) {
    case "mode":
      return action.mode === state.mode
        ? state
        : { ...cleared(state), mode: action.mode, text: "", pinned: false };
    case "text":
      return { ...state, text: action.text };
    case "chips":
      return { ...state, chips: action.chips };
    case "only":
      return { ...state, only: action.only };
    case "pin":
      return { ...state, pinned: state.status === "done" };
    case "unpin":
      return { ...state, pinned: false };
    default:
      return { ...cleared(state), pinned: false };
  }
}

function run(state: QueryState, action: QueryAction): QueryState {
  switch (action.type) {
    case "loading":
      return { ...state, status: "loading", error: undefined };
    case "loaded":
      return {
        ...state,
        status: state.status === "loading" ? "idle" : state.status,
        loaded: new Set([...state.loaded, action.mode]),
      };
    case "running":
      return { ...state, status: "running", error: undefined };
    case "succeeded":
      return {
        ...state,
        status: "done",
        result: action.result,
        error: undefined,
        history: remember(state),
      };
    case "failed":
      return { ...state, status: "failed", result: undefined, error: action.error, pinned: false };
    default:
      return edit(state, action);
  }
}

/** The bar's next state; `reset` is Esc and "Show all": the result goes, the query stays. */
export const reduceQuery = (state: QueryState, action: QueryAction): QueryState =>
  run(state, action);

/** The pin to save in `meta.outputQuery`, or undefined when nothing is pinned. */
export const pinOf = (state: QueryState): QueryPin | undefined =>
  state.pinned ? { mode: state.mode, query: queryText(state) } : undefined;

/** The bar for a saved pin: its mode and query, ready to run; a Filter text that no longer parses opens empty. */
export function fromPin(pin: QueryPin): QueryState {
  const base = { ...initialQuery(pin.mode), pinned: true };
  if (pin.mode !== "filter") return { ...base, text: pin.query };
  const parsed = parseFilter(pin.query);
  return parsed.ok ? { ...base, chips: parsed.value } : { ...base, pinned: false };
}
