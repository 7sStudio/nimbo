// The Activity log's rows in words (panel/ActivityTab.vue): each row of store/activity.ts as Time, Kind, What (with a
// detail: a request's event type, a failed call's error), From, To (the cell it went to, when there is one), Result
// with its tone, and Duration. From and To say who called whom: "you" or "claude-code over MCP" to "server, cell 2",
// "page" to "server, cell 3", "curl 127.0.0.1" to "server, cell 4".
import type { CellId, Execution } from "@jsnb/core";

import { durationText } from "../cells/runWords.js";
import type { ActivityRow } from "../store/activity.js";

export type Tone = "ok" | "err" | "muted";

export type ActivityLine = {
  readonly key: string;
  readonly time: string;
  readonly kind: string;
  readonly what: string;
  readonly detail: string;
  readonly from: string;
  readonly to: { readonly words: string; readonly cell: CellId | null };
  readonly result: string;
  readonly tone: Tone;
  readonly took: string;
};

/** What the words need from the notebook: a cell's name and place, and the cell that exports a bridge function. */
export type LineContext = {
  readonly nameOf: (cell: CellId) => string;
  /** "server, cell 3", "page, cell 5", "server, a deleted cell". */
  readonly whereOf: (cell: CellId) => string;
  readonly exporterOf: (fn: string) => CellId | undefined;
};

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** "14:01:10.020" by the page's clock. */
export function timeOf(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const seconds = `${pad(at.getSeconds())}.${pad(at.getMilliseconds(), 3)}`;
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${seconds}`;
}

const clients = { ui: "you", cli: "the CLI", mcp: "MCP", file: "the file" } as const;

/** "you", "the CLI", "claude-code over MCP"; "" for a run that does not say. */
function requester(by: Execution["requestedBy"] | null): string {
  if (by === null || by === undefined) return "";
  if (by.client === "ui") return "you";
  return by.agent === undefined ? clients[by.client] : `${by.agent} over ${clients[by.client]}`;
}

const runResults = {
  ok: ["ok", "ok"],
  error: ["failed", "err"],
  interrupted: ["interrupted", "muted"],
  running: ["running", "muted"],
  queued: ["queued", "muted"],
  idle: ["", "muted"],
} as const;

type Row<K extends ActivityRow["kind"]> = Extract<ActivityRow, { readonly kind: K }>;
type Base = Pick<ActivityLine, "key" | "time" | "took">;

const runLine = (row: Row<"run">, base: Base, context: LineContext): ActivityLine => {
  const [result, tone] = row.notRun ? (["not run", "muted"] as const) : runResults[row.status];
  return {
    ...base,
    kind: "cell run",
    what: context.nameOf(row.cell),
    detail: "",
    from: requester(row.by),
    to: { words: context.whereOf(row.cell), cell: row.cell },
    result,
    tone,
  };
};

const routeLine = (row: Row<"route">, base: Base, context: LineContext): ActivityLine => ({
  ...base,
  kind: "route request",
  what: row.name,
  detail: row.type,
  // the daemon listens on 127.0.0.1 alone: every request comes through this machine
  from: row.from === null ? "127.0.0.1" : `${row.from} 127.0.0.1`,
  to: { words: context.whereOf(row.cell), cell: row.cell },
  result: row.status === null ? "" : String(row.status),
  tone: row.status !== null && row.status >= 400 ? "err" : "ok",
});

const bridgeLine = (row: Row<"bridge">, base: Base, context: LineContext): ActivityLine => {
  const exporter = context.exporterOf(row.fn);
  const settled =
    row.ok === null
      ? (["waiting", "muted"] as const)
      : row.ok
        ? (["ok", "ok"] as const)
        : (["failed", "err"] as const);
  return {
    ...base,
    kind: "bridge call",
    what: `${row.fn}(${row.args})`,
    detail: row.error,
    from: "page",
    to:
      exporter === undefined
        ? { words: "server", cell: null }
        : { words: context.whereOf(exporter), cell: exporter },
    result: settled[0],
    tone: settled[1],
  };
};

/** `row` in words. */
export function lineOf(row: ActivityRow, context: LineContext): ActivityLine {
  const base = {
    key: row.key,
    time: timeOf(row.at),
    took: row.ms === null ? "" : durationText(row.ms),
  };
  if (row.kind === "run") return runLine(row, base, context);
  if (row.kind === "route") return routeLine(row, base, context);
  return bridgeLine(row, base, context);
}
