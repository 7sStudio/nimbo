// What the queue runs (02-architecture §5): a markdown cell is `ok` with no outputs (03-api §4.3.1), a server cell runs
// in the kernel, a client cell in the attached page, each with the cell's source as it is when the run starts; a run
// whose cell was deleted before it started, or whose notebook.run stopped on an error, ends `interrupted` without
// running, the latter naming the cell whose run failed (`stoppedBy`). Every other queued run executes in call
// order, a cell run twice included.
import type { CellId } from "@jsnb/core";

import type { SessionContext } from "../context.js";
import type { CellRecord, ExecutionRecord } from "../records.js";
import { terminalStatuses } from "../records.js";
import { finish } from "./executions.js";
import type { QueuedRun } from "./queue.js";
import { runServerCell } from "./server.js";

/** Ends a run that never started: `interrupted`, no outputs, no duration; `stoppedBy`, the cell whose failed run
 * stopped its notebook.run, when that is why. */
export function cancel(
  context: SessionContext,
  execution: ExecutionRecord,
  stoppedBy?: CellId,
): void {
  if (terminalStatuses.has(execution.status)) return;
  if (stoppedBy !== undefined) execution.stoppedBy = stoppedBy;
  finish(context, execution, { status: "interrupted", durationMs: 0 });
}

/** The client realm's side of a run, which the realm part provides. */
export type ClientRunner = (execution: ExecutionRecord) => Promise<void>;

/** Runs the cell in its realm; a run that started there records the code it ran (CellRecord.ran). */
async function runIn(
  context: SessionContext,
  execution: ExecutionRecord,
  record: CellRecord,
  client: ClientRunner,
): Promise<void> {
  const code = { source: record.source, type: record.type };
  if (record.type === "markdown") finish(context, execution, { status: "ok", durationMs: 0 });
  else if (record.type === "server") await runServerCell(context, execution, record);
  else await client(execution);
  if (execution.count !== undefined) record.ran = code;
}

/** Runs one queued run to its terminal status. */
export async function executeRun(
  context: SessionContext,
  run: QueuedRun,
  client: ClientRunner,
): Promise<void> {
  const { execution } = run;
  const record = context.cells.get(execution.cell);
  if (run.batch?.stopped === true || !record) {
    cancel(context, execution, run.batch?.stopped === true ? run.batch.stoppedBy : undefined);
    return;
  }
  await runIn(context, execution, record, client);
  if (run.batch && execution.status === "error") {
    run.batch.stopped = true;
    run.batch.stoppedBy = execution.cell;
  }
}
