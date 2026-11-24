// The bottom panel's Activity log: what crossed between you, the page, the server
// and outside senders while this page was open, from what the page already knows. Cell runs are every run the mirror
// followed (its executions: the status events, then the fetched run with its duration and who asked for it); route
// requests are the event outputs the kernel attributes to a route's cell, each with its status, time and sender; bridge
// calls are the ones this page's realm made (realm/mount.ts reports them). Nothing inside a cell is traced. The log
// keeps its last 300 rows, oldest first.
import type { CellId, ExecStatus, Execution } from "@jsnb/core";
import { defineStore } from "pinia";
import { shallowRef, watch } from "vue";

import { useNotebookStore } from "./notebook.js";

type RunRow = {
  readonly kind: "run";
  readonly key: string;
  readonly at: string;
  readonly cell: CellId;
  readonly status: ExecStatus;
  /** Run all stopped at a failure before this run started (`Execution.stoppedBy`): it never ran, and took no time. */
  readonly notRun: boolean;
  readonly ms: number | null;
  readonly by: Execution["requestedBy"] | null;
};

type RouteRow = {
  readonly kind: "route";
  readonly key: string;
  readonly at: string;
  readonly cell: CellId;
  /** "POST /webhook". */
  readonly name: string;
  readonly status: number | null;
  /** The event type the body named, "" for none. */
  readonly type: string;
  readonly ms: number | null;
  /** The sender its User-Agent names ("curl"), null for none. */
  readonly from: string | null;
};

type BridgeRow = {
  readonly kind: "bridge";
  readonly key: string;
  readonly at: string;
  readonly fn: string;
  /** The arguments as short text: `2000, "usd"`. */
  readonly args: string;
  /** null while the call is on its way. */
  readonly ok: boolean | null;
  /** The failure's name and message, "" when it went well. */
  readonly error: string;
  readonly ms: number | null;
};

export type ActivityRow = RunRow | RouteRow | BridgeRow;

/** How many rows the log keeps. */
const kept = 300;

const field = (data: unknown, key: string): unknown =>
  typeof data === "object" && data !== null ? Reflect.get(data, key) : undefined;
const numberOr = (value: unknown): number | null => (typeof value === "number" ? value : null);

/** A route request's event: "POST /webhook" with a numeric status (an `on()` listener's event has neither). */
const isRequest = (name: string, data: unknown): boolean =>
  /^[A-Z]+ \//u.test(name) && typeof field(data, "status") === "number";

/** The rows `execution` gives: its run, and the requests its route cell answered. */
function rowsOf(execution: Execution): ActivityRow[] {
  const run: RunRow = {
    kind: "run",
    key: execution.id,
    at: execution.startedAt,
    cell: execution.cell,
    status: execution.status,
    notRun: execution.stoppedBy !== undefined,
    ms: execution.stoppedBy === undefined ? (execution.durationMs ?? null) : null,
    by: execution.requestedBy ?? null,
  };
  const requests = execution.outputs.flatMap((output, index): RouteRow[] => {
    if (output.kind !== "event" || !isRequest(output.name, output.data)) return [];
    const type = field(output.data, "type");
    const from = field(output.data, "from");
    return [
      {
        kind: "route",
        key: `${execution.id}:${String(index)}`,
        at: output.at,
        cell: execution.cell,
        name: output.name,
        status: numberOr(field(output.data, "status")),
        type: typeof type === "string" ? type : "",
        ms: numberOr(field(output.data, "durationMs")),
        from: typeof from === "string" ? from : null,
      },
    ];
  });
  return [run, ...requests];
}

/** `rows` with each of `next` in its place by key (a later fact of the same run replaces it), oldest first, the last
 * `kept` of them. */
function merged(
  rows: readonly ActivityRow[],
  next: readonly ActivityRow[],
): readonly ActivityRow[] {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  for (const row of next) byKey.set(row.key, row);
  return [...byKey.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).slice(-kept);
}

/** A bridge call's arguments as short text: each argument's JSON, cut at 60 characters. */
function argsText(args: readonly unknown[]): string {
  const text = args.map((arg) => JSON.stringify(arg)).join(", ");
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

export const useActivityStore = defineStore("activity", () => {
  const notebook = useNotebookStore();
  const rows = shallowRef<readonly ActivityRow[]>([]);
  let calls = 0;
  /** The runs already logged as they are: the mirror replaces a run's object when it changes, and only that one. */
  const seen = new WeakSet<Execution>();
  // Side effect: every run the mirror follows, and every request its route cells answered, joins the log.
  watch(
    () => notebook.mirror.executions,
    (executions) => {
      const changed = [...executions.values()].filter((execution) => !seen.has(execution));
      for (const execution of changed) seen.add(execution);
      if (changed.length > 0) rows.value = merged(rows.value, changed.flatMap(rowsOf));
    },
    { immediate: true },
  );
  /** A bridge call this page's realm makes: its row now, and the function that ends it (null: it went well). */
  function bridgeCall(fn: string, args: readonly unknown[]): (failure: unknown) => void {
    calls += 1;
    const started = performance.now();
    const row: BridgeRow = {
      kind: "bridge",
      key: `bridge:${String(calls)}`,
      at: new Date().toISOString(),
      fn,
      args: argsText(args),
      ok: null,
      error: "",
      ms: null,
    };
    rows.value = merged(rows.value, [row]);
    return (failure) => {
      const error = failure instanceof Error ? `${failure.name}: ${failure.message}` : "";
      const ended = { ...row, ok: failure === null, error, ms: performance.now() - started };
      rows.value = merged(rows.value, [ended]);
    };
  }
  return { rows, bridgeCall };
});
