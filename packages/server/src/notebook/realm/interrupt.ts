// kernel.interrupt while the page runs a client cell: the page is asked to end that run
// (realm.interrupt: it answers with the names the run defined, which join the record whatever report of the page's
// lands first, and its container's DOM, the run's `dom` output so the container stays in its cell, and answers its
// realm.execute at once), and whatever the page does, the daemon ends the run `interrupted` itself within `pageWaitMs`
// and stops waiting for it, so the queue goes on even behind a page whose own loop froze it; the page's later reports
// on the run are dropped. A run the page had already finished when the interrupt crossed its end is left to the page's
// own report, which ends it as it ended (`ok` with its names), never `interrupted`.
import { RealmInterruptAnswer } from "@jsnb/core";

import type { SessionContext } from "../session/context.js";
import type { ExecutionRecord } from "../session/records.js";
import { terminalStatuses } from "../session/records.js";
import { addOutput, finish } from "../session/runs/executions.js";
import type { RealmDeps, RealmState } from "./state.js";
import { remember } from "./state.js";

/** How long the page has to take realm.interrupt, as kernel.interrupt answers within a second. */
const pageWaitMs = 1000;

/** What the page's answer keeps of the run it ended: its names in the record, its container's DOM as its output. */
function keep(
  context: SessionContext,
  run: {
    readonly state: RealmState;
    readonly deps: RealmDeps;
    readonly execution: ExecutionRecord;
  },
  answer: RealmInterruptAnswer,
): void {
  const { state, deps, execution } = run;
  if (answer.defines) remember(state, execution.cell, answer.defines);
  if (answer.dom === undefined) return;
  const { html, text } = answer.dom;
  addOutput(context, execution, { kind: "dom", html: deps.redact(html), text: deps.redact(text) });
}

/** realm.interrupt to the page: true when the page answered that it held no run in progress any more. */
async function askThePage(
  context: SessionContext,
  run: {
    readonly state: RealmState;
    readonly deps: RealmDeps;
    readonly execution: ExecutionRecord;
  },
): Promise<boolean> {
  const { attachment } = run.state;
  if (!attachment) return false;
  const { execution } = run;
  const signal = AbortSignal.any([AbortSignal.timeout(pageWaitMs), attachment.detached.signal]);
  try {
    const answer = RealmInterruptAnswer.parse(
      await attachment.page.request("realm.interrupt", { execution: execution.id }, signal),
    );
    keep(context, run, answer);
    return answer.defines === undefined;
  } catch (error) {
    context.log.warn(
      { err: error, execution: execution.id },
      "the page did not take realm.interrupt",
    );
    if (!attachment.detached.signal.aborted) run.state.onUnresponsive?.();
    return false;
  }
}

/**
 * Ends the client run `execution` here, `interrupted` with the time it took unless it already ended; its stop is
 * aborted first, so a run still taking the kernel's snapshot never goes to the page and stops waiting for it.
 */
export function stopClientRun(
  context: SessionContext,
  state: RealmState,
  execution: ExecutionRecord,
): void {
  const stop = state.stops.get(execution.id);
  stop?.controller.abort();
  if (terminalStatuses.has(execution.status)) return;
  const durationMs = stop === undefined ? 0 : performance.now() - stop.startedAt;
  finish(context, execution, { status: "interrupted", durationMs });
}

/**
 * Ends the client run `execution` the page runs; answers false when the page had already finished it (its own `ok` or
 * `error` report is on its way and ends it as it ended), true when the run ends `interrupted` here.
 */
export async function interruptClientRun(
  context: SessionContext,
  state: RealmState,
  deps: RealmDeps,
  execution: ExecutionRecord,
): Promise<boolean> {
  // realm.execute went to the page (status running is set as it goes): the page holds the run, or held it; one still
  // taking the kernel's snapshot never reaches the page and ends here at once
  if (execution.status === "running" && (await askThePage(context, { state, deps, execution })))
    return false;
  stopClientRun(context, state, execution);
  return true;
}
