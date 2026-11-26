// The run of a server cell: transform with the cell's URL, the
// pre-flight that ends a run importing an uninstalled package with MissingPackage before anything executes,
// then `execute` on the started kernel, its outputs and statuses streamed as events, and the stale flags after a
// successful run. A kernel the daemon itself ends (restart, close) interrupts the run; any other death fails it.
import type { CellAnalysis } from "@jsnb/core";
import { afterRun, cellUrl, isJsnbError, MissingPackage } from "@jsnb/core";
import type { NodeKernel } from "@jsnb/kernel-node";
import { missingPackages } from "@jsnb/kernel-node";
import { transform, withDebuggerStatements } from "@jsnb/transform";

import { clientNameError } from "../../realm/names.js";
import type { SessionContext } from "../context.js";
import { restale } from "../edits.js";
import type { CellRecord, ExecutionRecord } from "../records.js";
import { terminalStatuses } from "../records.js";
import { runError } from "./errors.js";
import type { Ending } from "./executions.js";
import { addOutput, finish, setStatus } from "./executions.js";
import { exportsAfter } from "./exportsClock.js";

type Compiled = {
  readonly code: string;
  readonly map: string;
  readonly analysis: CellAnalysis;
};

export type Prepared =
  | { readonly ok: true; readonly compiled: Compiled }
  | { readonly ok: false; readonly ending: Ending };

const failed = (error: unknown, record: CellRecord): Prepared => ({
  ok: false,
  ending: { status: "error", durationMs: 0, error: runError(error, record.id, record.source) },
});

/** A client cell's code with a `debugger;` on each breakpoint line; it goes without them if they break it. */
function clientSource(context: SessionContext, record: CellRecord): string {
  const lines = context.hooks.debuggerLines(record.id);
  if (record.type !== "client" || lines.length === 0) return record.source;
  try {
    return withDebuggerStatements(record.source, lines);
  } catch {
    return record.source;
  }
}

/** The transform with the cell's URL, or the ending of a run whose cell does not parse (a result). */
export function compileCell(context: SessionContext, record: CellRecord): Prepared {
  try {
    return {
      ok: true,
      compiled: transform(clientSource(context, record), {
        filename: cellUrl(context.ref, record.id),
      }),
    };
  } catch (error) {
    if (isJsnbError(error)) return failed(error, record);
    throw error;
  }
}

/** The transform and the pre-flight: the code to run, or the ending of a run that cannot start. */
function prepare(context: SessionContext, record: CellRecord): Prepared {
  const prepared = compileCell(context, record);
  if (!prepared.ok) return prepared;
  const names = missingPackages(context.root, prepared.compiled.analysis.imports);
  if (names.length > 0) return failed(new MissingPackage({ names }), record);
  return prepared;
}

async function stream(
  context: SessionContext,
  kernel: NodeKernel,
  execution: ExecutionRecord,
  compiled: Compiled,
) {
  const { code, map, analysis } = compiled;
  const request = {
    execution: execution.id,
    cell: execution.cell,
    code,
    map,
    defines: analysis.defines,
    kinds: analysis.kinds,
  };
  // Counted before the execute is sent: the kernel's messages for a quick run (running, status, exports) can all be
  // delivered before this loop sees the first of them.
  const seen = context.runs.exports.seen;
  for await (const event of kernel.execute(request)) {
    if (event.kind === "output") addOutput(context, execution, event.output, event.full);
    else if (event.status === "running") setStatus(context, execution, "running");
    else {
      const { status, durationMs, error } = event;
      // The exports message follows the status; a run the daemon interrupted ends without waiting for it.
      if (status !== "interrupted") await exportsAfter(context.runs.exports, context.log, seen);
      // a name only a client cell defines is the page's: the kernel's ReferenceError says DefinedInClient instead
      const ended =
        error === undefined ? {} : { error: clientNameError(context, execution.cell, error) };
      finish(context, execution, { status, durationMs, ...ended });
    }
  }
}

/** Runs a server cell to its terminal status. */
export async function runServerCell(
  context: SessionContext,
  execution: ExecutionRecord,
  record: CellRecord,
): Promise<void> {
  const prepared = prepare(context, record);
  if (!prepared.ok) {
    finish(context, execution, prepared.ending);
    return;
  }
  execution.defines = prepared.compiled.analysis.defines;
  try {
    const kernel = await context.kernel.ready();
    await context.hooks.beforeServerRun(record.id);
    if (terminalStatuses.has(execution.status)) return; // interrupted while the kernel started
    context.kernel.executing(execution.cell);
    await stream(context, kernel, execution, prepared.compiled);
  } catch (error) {
    if (terminalStatuses.has(execution.status)) return; // it already ended (interrupted while the kernel started)
    const ending: Ending = context.runs.ending
      ? { status: "interrupted", durationMs: 0 }
      : { status: "error", durationMs: 0, error: runError(error, record.id) };
    finish(context, execution, ending);
  } finally {
    context.kernel.executing(null);
  }
  if (execution.status === "ok")
    restale(context, afterRun(context.cells.graph(), context.cells.stale(), execution.cell));
}
