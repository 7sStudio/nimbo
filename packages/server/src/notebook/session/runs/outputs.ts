// What a session answers about its runs' outputs (03-api §4.3, §7.5): a cell's last execution, a value's full form
// (retained, or the output's own json when it was not cut) and its slices; only each cell's last run is kept, so any
// other execution or an index that is no value output is INVALID_PARAMS naming it.
import type { CellId, ExecutionId, Output } from "@jsnb/core";
import { InvalidParams } from "@jsnb/core";
import { parsePath } from "@jsnb/query-json";

import type { SessionContext } from "../context.js";
import type { ExecutionRecord } from "../records.js";
import { findExecution } from "./executions.js";
import type { Slice } from "./slice.js";
import { nodeAt, sliceOf } from "./slice.js";

const invalid = (path: string, message: string): InvalidParams =>
  new InvalidParams({ issues: [{ path: [path], message }] });

type ValueOutput = Extract<Output, { kind: "value" }>;

/** The value output `index` of `execution`, or INVALID_PARAMS. */
function valueOutput(execution: ExecutionRecord, index: number): ValueOutput {
  const output = execution.outputs[index];
  if (output?.kind !== "value") {
    throw invalid("index", `output ${String(index)} of ${execution.id} is not a value output`);
  }
  return output;
}

/** The last run of `cell`, which `execution` must name when given. */
function lastRun(
  context: SessionContext,
  cell: CellId,
  execution: ExecutionId | undefined,
): ExecutionRecord {
  const last = context.cells.require(cell).last;
  if (!last) throw invalid("cell", `${cell} has not run yet`);
  if (execution !== undefined && execution !== last.id) {
    throw invalid(
      "execution",
      `${execution} is not the last run of ${cell}; only each cell's last run is kept`,
    );
  }
  return last;
}

/** The whole value of output `index` of `run`: retained, or the output's json when it was never cut; else INVALID_PARAMS. */
export function fullValueOf(context: SessionContext, run: ExecutionRecord, index: number): unknown {
  const output = valueOutput(run, index);
  const retained = context.runs.retained.get(run.id, index);
  if (retained) return retained.json;
  if (!output.truncated) return output.json;
  throw invalid(
    "index",
    `the full value of output ${String(index)} of ${run.id} ${whyNotKept(context, run, index)}`,
  );
}

/**
 * A value larger than the budget: the one its kernel cut it at, which a new outputs.retainMaxBytes changes only once
 * the kernel restarts, or the one it was sized against here.
 */
const tooLargeReason = (refusal: {
  readonly budget: number;
  readonly byKernel: boolean;
}): string => {
  const said = `was never retained: it is larger than outputs.retainMaxBytes (${String(refusal.budget)} bytes)`;
  return refusal.byKernel
    ? `${said}, the value its kernel started with; restart the kernel (kernel.restart) to apply a new outputs.retainMaxBytes`
    : said;
};

/** Why a cut value has no full form here: retention is off, larger than the budget, no full form came, or let go since. */
function whyNotKept(context: SessionContext, run: ExecutionRecord, index: number): string {
  const settings = context.settings();
  if (!settings["outputs.retainFullValue"])
    return "is not retained: outputs.retainFullValue is off";
  const refusal = context.runs.retained.refusal(run.id, index);
  if (refusal?.why === "tooLarge") return tooLargeReason(refusal);
  if (refusal?.why === "noFullForm")
    return "was never retained: its kernel sent no full form (outputs.retainFullValue was off when it started, or the value was too deep to walk)";
  return "is no longer retained";
}

/** The whole value of output `index` of `execution` when it is one of this session's last runs (undefined otherwise). */
export function fullValue(
  context: SessionContext,
  execution: ExecutionId,
  index: number,
): { readonly json: unknown } | undefined {
  const run = findExecution(context, execution);
  return run ? { json: fullValueOf(context, run, index) } : undefined;
}

export type ValueRequest = {
  readonly cell: CellId;
  readonly execution?: ExecutionId | undefined;
  readonly index: number;
  readonly path: string;
  readonly offset: number;
  readonly limit: number;
};

/** cell.outputValue: the slice of a value, from its full form when retained, else from what the output holds. */
export function outputValue(context: SessionContext, request: ValueRequest): Slice {
  const run = lastRun(context, request.cell, request.execution);
  const output = valueOutput(run, request.index);
  const root = context.runs.retained.get(run.id, request.index)?.json ?? output.json;
  const path = parsePath(request.path);
  if (!path.ok) throw invalid("path", path.error.message);
  const found = nodeAt(root, path.value);
  if (!found)
    throw invalid("path", `${request.path} leads to nothing in output ${String(request.index)}`);
  return sliceOf(found.node, request, context.settings()["outputs.maxValueBytes"]);
}

/** The execution of output queries and downloads: `execution`, else the last run of `cell`. */
export const queriedRun = (
  context: SessionContext,
  cell: CellId,
  execution: ExecutionId | undefined,
): ExecutionRecord => lastRun(context, cell, execution);
