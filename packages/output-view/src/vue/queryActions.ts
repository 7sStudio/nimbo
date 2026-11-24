// The query bar's actions over its state (11-query §4), for useQueryBar: load a mode's engine on first use, run (and
// pin), reset, recall history, add a grid column's chip, switch mode and cancel. Each takes the bar it acts on.
import type { QueryMode } from "@jsnb/core";
import type { Ref, ShallowRef } from "vue";
import { ref, shallowRef } from "vue";

import type { Chip } from "../model/chips.js";
import { availableModes, defaultMode } from "../model/engines.js";
import type { QueryEngines } from "../model/engines.js";
import { parseFilter } from "../model/filter.js";
import type { QueryAction, QueryPin, QueryState } from "../model/query.js";
import { fromPin, initialQuery, pinOf, reduceQuery } from "../model/query.js";
import { loadMode, runQuery } from "../model/run.js";
import type { SqlTable } from "./useSqlTable.js";

export type QueryBarSource = {
  readonly engines: Readonly<Ref<QueryEngines | undefined>>;
  readonly json: Readonly<Ref<unknown>>;
  readonly view: Readonly<Ref<"tree" | "grid">>;
  readonly pin: QueryPin | undefined;
  readonly filter: string | undefined;
  readonly table: SqlTable;
  /** A pin was made or undone: the host saves it as `meta.outputQuery`. */
  readonly onPin: (pin: QueryPin | undefined) => void;
};

type Progress = { readonly loadedBytes: number; readonly totalBytes: number };

export type Bar = {
  readonly source: QueryBarSource;
  readonly state: ShallowRef<QueryState>;
  readonly open: Ref<boolean>;
  readonly progress: Ref<Progress | undefined>;
  readonly recalled: Ref<number>;
  /** The mode last picked or run on each view (11-query §1: the bar remembers the last mode per view). */
  readonly last: Partial<Record<"tree" | "grid", QueryMode>>;
  controller: AbortController | undefined;
};

export const engines = (bar: Bar): QueryEngines => bar.source.engines.value ?? {};
export const dispatch = (bar: Bar, action: QueryAction): void => {
  bar.state.value = reduceQuery(bar.state.value, action);
};

function initial(source: QueryBarSource): QueryState {
  if (source.pin) return fromPin(source.pin);
  const all = source.engines.value ?? {};
  const parsed = source.filter === undefined ? undefined : parseFilter(source.filter);
  if (parsed?.ok && availableModes(all).includes("filter"))
    return { ...initialQuery("filter"), chips: parsed.value };
  return initialQuery(defaultMode(all, source.view.value) ?? "jsonpath");
}

/** A bar over `source`: open at once when a pin or a filter gives it something to show. */
export function barOf(source: QueryBarSource): Bar {
  const state = shallowRef(initial(source));
  return {
    source,
    state,
    open: ref(state.value.pinned || state.value.chips.length > 0),
    progress: ref(),
    recalled: ref(-1),
    last: {},
    controller: undefined,
  };
}

function fresh(bar: Bar): AbortSignal {
  bar.controller?.abort();
  bar.controller = new AbortController();
  return bar.controller.signal;
}

async function load(bar: Bar, mode: QueryMode, signal: AbortSignal): Promise<boolean> {
  if (bar.state.value.loaded.has(mode)) return true;
  dispatch(bar, { type: "loading" });
  const loaded = await loadMode(engines(bar), mode, (p) => (bar.progress.value = p), signal);
  bar.progress.value = undefined;
  dispatch(bar, loaded.ok ? { type: "loaded", mode } : { type: "failed", error: loaded.error });
  return loaded.ok;
}

/** The engine loaded and, in SQL mode, this output's rows in `t`. */
async function prepare(bar: Bar, mode: QueryMode, signal: AbortSignal): Promise<boolean> {
  if (!(await load(bar, mode, signal))) return false;
  if (mode !== "sql") return true;
  const ready = await bar.source.table.ensure(signal);
  if (!ready.ok) dispatch(bar, { type: "failed", error: ready.error });
  return ready.ok;
}

export async function run(bar: Bar, pin: boolean): Promise<void> {
  const signal = fresh(bar);
  const { mode, text, chips } = bar.state.value;
  bar.last[bar.source.view.value] = mode;
  if (!(await prepare(bar, mode, signal))) return;
  dispatch(bar, { type: "running" });
  const json = bar.source.json.value;
  const outcome = await runQuery(engines(bar), { mode, text, chips, at: "$", json, signal });
  if (signal.aborted) return;
  dispatch(
    bar,
    outcome.ok
      ? { type: "succeeded", result: outcome.value }
      : { type: "failed", error: outcome.error },
  );
  if (!pin || !outcome.ok) return;
  dispatch(bar, { type: "pin" });
  bar.source.onPin(pinOf(bar.state.value));
}

/** Esc and "Back to source": the result goes (and its pin), the query stays; Esc also closes the bar. */
export function reset(bar: Bar, close: boolean): void {
  bar.controller?.abort();
  const pinned = bar.state.value.pinned;
  dispatch(bar, { type: "reset" });
  if (pinned) bar.source.onPin(undefined);
  if (close) bar.open.value = false;
}

/** ↑ (1) and ↓ (-1) through the mode's history; past the newest, the input empties. */
export function recall(bar: Bar, direction: 1 | -1): void {
  const { history, mode } = bar.state.value;
  const entries = history[mode] ?? [];
  bar.recalled.value = Math.min(entries.length - 1, Math.max(-1, bar.recalled.value + direction));
  const text = entries[bar.recalled.value] ?? "";
  const parsed = mode === "filter" ? parseFilter(text) : undefined;
  dispatch(bar, parsed?.ok ? { type: "chips", chips: parsed.value } : { type: "text", text });
}

/** A grid column's filter (11-query §4): one more chip in Filter mode, run at once. */
export async function addChip(bar: Bar, chip: Chip): Promise<void> {
  if (bar.state.value.mode !== "filter") dispatch(bar, { type: "mode", mode: "filter" });
  dispatch(bar, { type: "chips", chips: [...bar.state.value.chips, chip] });
  bar.open.value = true;
  await run(bar, false);
}

export async function setMode(bar: Bar, mode: QueryMode): Promise<void> {
  dispatch(bar, { type: "mode", mode });
  bar.last[bar.source.view.value] = mode;
  bar.recalled.value = -1;
  await load(bar, mode, fresh(bar));
}

/** Opens the bar; a bar with nothing typed takes the view's last mode, or its default (tree JSONPath, grid SQL). */
export function openBar(bar: Bar): void {
  const { status, text, chips } = bar.state.value;
  const view = bar.source.view.value;
  const mode = bar.last[view] ?? defaultMode(engines(bar), view);
  if (status === "idle" && text === "" && chips.length === 0 && mode !== undefined)
    dispatch(bar, { type: "mode", mode });
  bar.open.value = true;
}

export function cancel(bar: Bar): void {
  bar.controller?.abort();
  dispatch(bar, { type: "failed", error: { kind: "cancelled", message: "Cancelled." } });
}
