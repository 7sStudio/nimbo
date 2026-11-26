// One run's record (03-api §5 Execution) as it moves through 02-architecture §5: created queued (the cell's previous
// run's retained values dropped), every status transition a cell.status event, every output a cell.output event and,
// for a value, its full form retained; the terminal status with its duration and error. The cell's events follow its
// latest run: an earlier run of a cell run again goes on and answers its own waiter, without events.
import type { CellId, ErrorInfo, ExecStatus, ExecutionId, FullValue, Output } from "@jsnb/core";

import type { SessionContext } from "../context.js";
import type { ExecutionRecord } from "../records.js";
import { terminalStatuses } from "../records.js";
import { savesOutputs } from "../fileForm.js";

/** An execution id no cell of the notebook uses (09-testing §1.4: from the injected generator). */
function freshId(context: SessionContext): ExecutionId {
  const used = new Set(
    context.cells.list().flatMap((record) => (record.last ? [record.last.id] : [])),
  );
  let id = context.ids.execution();
  while (used.has(id)) id = context.ids.execution();
  return id;
}

/** The cell's run of `execution`, when it is still the cell's latest (events of older runs are dropped). */
const isLatest = (context: SessionContext, execution: ExecutionRecord): boolean =>
  context.cells.get(execution.cell)?.last === execution;

/** A queued run of `cell`: the cell's latest from now on. */
export function createExecution(
  context: SessionContext,
  cell: CellId,
  defines: readonly string[],
  by: {
    readonly requestedBy?: ExecutionRecord["requestedBy"];
    readonly autoRun?: ExecutionRecord["autoRun"];
  } = {},
): ExecutionRecord {
  const { requestedBy, autoRun } = by;
  const record = context.cells.require(cell);
  if (record.last) context.runs.retained.drop(record.last.id);
  if (record.last && terminalStatuses.has(record.last.status)) record.previous = record.last;
  const execution: ExecutionRecord = {
    id: freshId(context),
    cell,
    status: "queued",
    startedAt: context.now().toISOString(),
    outputs: [],
    defines,
    ...(requestedBy === undefined ? {} : { requestedBy }),
    ...(autoRun === undefined ? {} : { autoRun }),
  };
  record.last = execution;
  record.status = "queued";
  context.emit("cell.status", { cell, execution: execution.id, status: "queued" });
  return execution;
}

/** A status transition; the cell follows its latest run. */
export function setStatus(
  context: SessionContext,
  execution: ExecutionRecord,
  status: ExecStatus,
): void {
  execution.status = status;
  if (status === "running" && execution.count === undefined)
    execution.count = context.runs.executions += 1;
  if (!isLatest(context, execution)) return;
  const record = context.cells.require(execution.cell);
  record.status = status;
  const { count } = execution;
  context.emit("cell.status", {
    cell: execution.cell,
    execution: execution.id,
    status,
    ...(count === undefined ? {} : { count }),
  });
}

export type Ending = {
  readonly status: ExecStatus;
  readonly durationMs: number;
  readonly error?: ErrorInfo;
};

/** The terminal status of a run with its duration and, for an error, its ErrorInfo. */
export function finish(context: SessionContext, execution: ExecutionRecord, ending: Ending): void {
  execution.endedAt = context.now().toISOString();
  execution.durationMs = ending.durationMs;
  if (ending.error) execution.error = ending.error;
  setStatus(context, execution, ending.status);
  // a finished run is a change of the file when the file keeps outputs, or holds some the policy now leaves out
  // (07-file-format §2)
  const outputsInFile = savesOutputs(context.settings(), context.header) || context.header.outputs;
  if (isLatest(context, execution) && outputsInFile) context.autosave.touched();
}

/**
 * One output: kept on its run (a waiter gets it), and for the cell's latest run streamed as cell.output with a value's
 * full form (or its own json) retained when allowed.
 */
export function addOutput(
  context: SessionContext,
  execution: ExecutionRecord,
  output: Output,
  full?: FullValue,
): void {
  const index = execution.outputs.length;
  execution.outputs.push(output);
  if (!isLatest(context, execution)) return;
  context.emit("cell.output", { cell: execution.cell, execution: execution.id, output });
  if (output.kind !== "value" || !context.settings()["outputs.retainFullValue"]) return;
  // a value is kept only when it is whole: the full form unless the kernel cut it at its budget (`full.truncated`:
  // never retained, larger than the budget), else the output's own json unless that is cut too
  const { retained } = context.runs;
  if (full?.truncated) {
    retained.refuse(execution.id, index, {
      why: "tooLarge",
      budget: context.runs.kernelBudget,
      byKernel: true,
    });
  } else if (full) retained.keep(execution.id, index, full.json);
  else if (output.truncated) retained.refuse(execution.id, index, { why: "noFullForm" });
  else retained.keep(execution.id, index, output.json);
}

/** The latest run of some cell with id `execution`, if any cell still has it. */
export function findExecution(
  context: SessionContext,
  execution: ExecutionId,
): ExecutionRecord | undefined {
  return context.cells.list().find((record) => record.last?.id === execution)?.last;
}
