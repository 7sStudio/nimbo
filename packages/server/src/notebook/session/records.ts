// What a notebook session holds per cell and per run, and their API forms: a cell record (the file's
// fields, unknown keys kept, its analysis, its status and last run) and an execution record (status, outputs, error).
import type {
  Cell,
  CellAnalysis,
  CellId,
  CellMeta,
  CellType,
  ErrorInfo,
  ExecStatus,
  Execution,
  ExecutionId,
  ExecutionSummary,
  FileCellMeta,
  Output,
} from "@jsnb/core";
import { cellMetaKeys } from "@jsnb/core";

import { apiEdit } from "./provenance.js";

export type ExecutionRecord = {
  readonly id: ExecutionId;
  readonly cell: CellId;
  status: ExecStatus;
  readonly startedAt: string;
  /** The kernel session's execution count, given when the run starts. */
  count?: number;
  endedAt?: string;
  durationMs?: number;
  timedOut?: boolean;
  readonly outputs: Output[];
  error?: ErrorInfo;
  /** notebook.run's stopOnError ended it unstarted after this cell's run failed. */
  stoppedBy?: CellId;
  /** The connection that asked for the run (cell.run, notebook.run, cell.add with run). */
  readonly requestedBy?: Execution["requestedBy"];
  /** execution.autoRunDependents started it after that run. */
  readonly autoRun?: Execution["autoRun"];
  defines: readonly string[];
  /** Read from the file's saved outputs: a run of an earlier session. */
  readonly restored?: true;
};

export type CellRecord = {
  readonly id: CellId;
  type: CellType;
  source: string;
  /** Every meta key the file had, unknown ones included. */
  meta: FileCellMeta;
  /** Unknown keys of the cell itself, written back in place. */
  readonly extra: Readonly<Record<string, unknown>>;
  analysis: CellAnalysis;
  status: ExecStatus;
  /** The cell's latest run, queued ones included. */
  last: ExecutionRecord | undefined;
  /** The finished run before `last` (cell.compare's "previous run"); a saved run counts. */
  previous?: ExecutionRecord | undefined;
  /** The code and type of the cell's last run that started in its realm, forgotten when the realm ends: what
   * execution.autoRunDependents may run again. */
  ran?: { readonly source: string; readonly type: CellType } | undefined;
};

export const terminalStatuses: ReadonlySet<ExecStatus> = new Set(["ok", "error", "interrupted"]);

/** The meta keys only: what the API returns (unknown keys stay in the file); a review in lastEdit gains
 * the lines `source` changed. */
function apiMeta(meta: FileCellMeta, source: string): CellMeta {
  const { lastEdit } = meta;
  return {
    ...Object.fromEntries(
      cellMetaKeys.flatMap((key) =>
        meta[key] === undefined || key === "lastEdit" ? [] : [[key, meta[key]]],
      ),
    ),
    ...(lastEdit === undefined ? {} : { lastEdit: apiEdit(lastEdit, source) }),
  };
}

function toSummary(execution: ExecutionRecord): ExecutionSummary {
  return {
    id: execution.id,
    status: execution.status,
    startedAt: execution.startedAt,
    ...(execution.count === undefined ? {} : { count: execution.count }),
    ...(execution.durationMs === undefined ? {} : { durationMs: execution.durationMs }),
    hasError: execution.status === "error",
    defines: [...execution.defines],
  };
}

export function toExecution(execution: ExecutionRecord): Execution {
  return {
    id: execution.id,
    cell: execution.cell,
    status: execution.status,
    startedAt: execution.startedAt,
    ...(execution.count === undefined ? {} : { count: execution.count }),
    ...(execution.endedAt === undefined ? {} : { endedAt: execution.endedAt }),
    ...(execution.durationMs === undefined ? {} : { durationMs: execution.durationMs }),
    ...(execution.timedOut === undefined ? {} : { timedOut: execution.timedOut }),
    outputs: [...execution.outputs],
    ...(execution.error === undefined ? {} : { error: execution.error }),
    ...(execution.stoppedBy === undefined ? {} : { stoppedBy: execution.stoppedBy }),
    ...(execution.requestedBy === undefined ? {} : { requestedBy: execution.requestedBy }),
    ...(execution.autoRun === undefined ? {} : { autoRun: execution.autoRun }),
    ...(execution.restored ? { restored: true as const } : {}),
  };
}

/** Whether the cell's last run in its realm ran other code than it has now: its result is of that code. */
export const ranOther = (record: CellRecord): boolean =>
  record.ran !== undefined &&
  (record.ran.source !== record.source || record.ran.type !== record.type);

/** The API form of a cell at `index`; `staleWhy` is the reason of a stale cell ("" for none). */
export function toCell(record: CellRecord, index: number, stale: boolean, staleWhy = ""): Cell {
  return {
    id: record.id,
    type: record.type,
    source: record.source,
    index,
    meta: apiMeta(record.meta, record.source),
    status: record.status,
    stale,
    ...(stale && staleWhy !== "" ? { staleWhy } : {}),
    lastExecution: record.last === undefined ? null : toSummary(record.last),
  };
}
