// realm.report: what the attached page reports about a client run it was sent (the handler refuses a
// realmId that names no attached page with INVALID_PARAMS), redacted at the daemon's boundary (a
// page that printed a value a bridge call returned holds nothing the kernel did not redact, but the daemon redacts
// what it relays anyway); then the run's events. A status carries the run's duration, the names it defines (the page's
// record) and, for an error, its ErrorInfo. Once the run ended, the page reports only late outputs (a timer's, a
// listener's), which join the run as a kernel's do. A report on a run that was interrupted
// or is no longer its cell's last is dropped whatever it carries: at a reset runtime-web flushes the dropped
// run's pending console text as a report, queues its `interrupted` status behind it on its one report chain and
// answers realm.execute at once, so whenever text was pending (or another report was still unanswered) the daemon has
// ended the run on the answer before that status comes, every time and not by timing.
import type { RealmReport } from "@jsnb/core";
import { ErrorInfo, InvalidParams, Output } from "@jsnb/core";

import type { SessionContext } from "../session/context.js";
import type { ExecutionRecord } from "../session/records.js";
import { terminalStatuses } from "../session/records.js";
import { addOutput, findExecution, finish, setStatus } from "../session/runs/executions.js";
import type { RealmDeps, RealmState } from "./state.js";
import { remember } from "./state.js";

const invalid = (path: string, message: string): InvalidParams =>
  new InvalidParams({ issues: [{ path: [path], message }] });

/** Every string inside a JSON value through `redact`; keys and the rest as they are. */
function redactDeep(value: unknown, redact: (text: string) => string): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map((item: unknown) => redactDeep(item, redact));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, redactDeep(item, redact)]),
  );
}

function applyStatus(
  context: SessionContext,
  execution: ExecutionRecord,
  report: RealmReport,
  deps: RealmDeps,
): void {
  const { status } = report;
  if (status === undefined) return;
  if (status === "running") {
    setStatus(context, execution, status);
    return;
  }
  if (!terminalStatuses.has(status))
    throw invalid("status", `a page reports running, ok, error or interrupted, not ${status}`);
  const error =
    report.error === undefined ? undefined : ErrorInfo.parse(redactDeep(report.error, deps.redact));
  finish(context, execution, {
    status,
    durationMs: report.durationMs ?? 0,
    ...(error === undefined ? {} : { error }),
  });
}

/**
 * A report on a client run that ended: dropped whatever it carries when the run is no longer its cell's last or was
 * interrupted (as an interrupted kernel run's late outputs are; the page's own `interrupted` report comes
 * after the answer that ended the run whenever another report was ahead of it); else a late output joins the run, and
 * a status, a duration, an error or the names it defines are refused: they come only while it runs.
 */
function lateReport(context: SessionContext, deps: RealmDeps, report: RealmReport): void {
  const execution = findExecution(context, report.execution);
  if (!execution || execution.status === "interrupted") return;
  const { status, error, durationMs, defines } = report;
  if ([status, error, durationMs, defines].some((field) => field !== undefined)) {
    throw invalid(
      "execution",
      `${report.execution} ended: a page reports only late outputs of a run that ended`,
    );
  }
  if (report.output)
    addOutput(context, execution, Output.parse(redactDeep(report.output, deps.redact)));
}

/** Applies one report of the attached page (the handler found this session by the report's realmId). */
export function applyReport(
  context: SessionContext,
  state: RealmState,
  deps: RealmDeps,
  report: RealmReport,
): void {
  const execution = state.running.get(report.execution);
  if (!execution || terminalStatuses.has(execution.status)) {
    if (!execution && !state.finished.has(report.execution))
      throw invalid("execution", `${report.execution} is not a client run this page was sent`);
    lateReport(context, deps, report);
    return;
  }
  if (report.output)
    addOutput(context, execution, Output.parse(redactDeep(report.output, deps.redact)));
  if (report.defines) remember(state, execution.cell, report.defines);
  applyStatus(context, execution, report, deps);
}
