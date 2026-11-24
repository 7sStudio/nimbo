// Execution and ExecutionSummary of 03-api §5: one run of a cell, in full and as the cell's last-run summary.
import { z } from "zod";

import { DebugPause } from "./debug.js";
import { CellId, ExecutionId } from "./ids.js";
import { ErrorInfo, Output } from "./output.js";

export const ExecStatus = z.enum(["idle", "queued", "running", "ok", "error", "interrupted"]);
export type ExecStatus = z.infer<typeof ExecStatus>;

export const Execution = z
  .object({
    id: ExecutionId,
    cell: CellId,
    status: ExecStatus,
    startedAt: z.string(),
    /** The kernel session's execution count, as Jupyter's: the nth run to start since the kernel started; none for a
     * run that never started (a markdown cell's, one taken off the queue) or one read from the file. */
    count: z.number().int().positive().optional(),
    endedAt: z.string().optional(),
    durationMs: z.number().optional(),
    timedOut: z.boolean().optional(),
    /** A waiting cell.run or notebook.run answered early: the kernel is paused in the debugger, where and why (the run
     * goes on once it resumes; `timedOut` is true with it). */
    paused: DebugPause.optional(),
    outputs: z.array(Output).readonly(),
    error: ErrorInfo.optional(),
    /** A run notebook.run's stopOnError ended `interrupted` before it started: the cell whose run failed. */
    stoppedBy: CellId.optional(),
    /** Who asked for the run: the connection's declaration (03-api §7.1), as `meta.lastEdit` names an editor. */
    requestedBy: z
      .object({ client: z.enum(["ui", "cli", "mcp", "file"]), agent: z.string().optional() })
      .readonly()
      .optional(),
    /** Read from the notebook file's saved outputs (07-file-format §2): a run of an earlier session, not this kernel's. */
    restored: z.literal(true).optional(),
  })
  .readonly();
export type Execution = z.infer<typeof Execution>;

export const ExecutionSummary = z
  .object({
    id: ExecutionId,
    status: ExecStatus,
    startedAt: z.string(),
    count: z.number().int().positive().optional(),
    durationMs: z.number().optional(),
    hasError: z.boolean(),
    defines: z.array(z.string()).readonly(),
  })
  .readonly();
export type ExecutionSummary = z.infer<typeof ExecutionSummary>;
