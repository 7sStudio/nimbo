// realm.execute: prepare the cell, evaluate the transform's output, run, settle.
import type { RealmExecute } from "@jsnb/core";
import { InvalidParams, RealmNotAttached } from "@jsnb/core";

import { domSnapshot } from "../display/snapshot.js";
import type { Run } from "./run.js";
import { createRun } from "./run.js";
import { exposeView } from "./debugScope.js";
import type { RealmState } from "./state.js";
import { refusalOf } from "./unbound.js";
import { valueOutput } from "./value.js";

type Outcome =
  | { readonly ok: true; readonly value: unknown; readonly durationMs: number }
  | { readonly ok: false; readonly error: unknown; readonly durationMs: number };

type CellFunction = (scope: Record<string, unknown>) => unknown;

const isCellFunction = (value: unknown): value is CellFunction => typeof value === "function";

const notACell =
  "the compiled cell is not a function; realm.execute carries the transform's output";

/**
 * The indirect eval: the code is `(async (__scope) => { "use strict"; … })` and its
 * sourceURL, so evaluating it only creates the cell function. Anything else is a fault of the request, not of the cell,
 * so realm.execute fails as a call (InvalidParams, -32602) before the realm changes.
 */
function compile(code: string): CellFunction {
  const evaluate: (text: string) => unknown = globalThis.eval;
  let compiled: unknown;
  try {
    compiled = evaluate(code);
  } catch (cause) {
    throw new InvalidParams({ issues: [{ path: ["code"], message: notACell }] }, { cause });
  }
  if (isCellFunction(compiled)) return compiled;
  throw new InvalidParams({ issues: [{ path: ["code"], message: notACell }] });
}

/**
 * A stale run's outputs are dropped and an in-progress one is reported `interrupted` (a reset, or a re-run of a cell
 * still running); its pending stream text goes out first, and realm.execute stops waiting for it.
 */
export function retire(state: RealmState, run: Run, reportInterrupt: boolean): void {
  run.streams.flush();
  if (reportInterrupt && run.flags.inProgress && !run.flags.stale) {
    const durationMs = performance.now() - run.flags.startedAt;
    const report = { execution: run.execution, status: "interrupted" as const, durationMs };
    void state.reports.status({ ...report, defines: [...run.defines].sort() }); // queued; failures reach onError
  }
  run.flags.stale = true;
  run.abandon();
}

/** The previous run's disposers (a throw is an error output on the new execution), its container emptied; the run
 * applies the limits the daemon sent with it, or the realm's own. */
function prepare(state: RealmState, params: RealmExecute): Run {
  const previous = state.runs.get(params.cell);
  const { cell, execution } = params;
  const limits = params.limits ?? state.options.limits;
  const run = createRun(state.context, { cell, execution, limits });
  if (previous) {
    previous.disposers.run(run.reportError);
    retire(state, previous, true);
  }
  state.runs.set(params.cell, run);
  state.containers.empty(params.cell);
  run.install(params.bindings);
  return run;
}

async function evaluate(run: Run, fn: CellFunction): Promise<Outcome> {
  run.flags.startedAt = performance.now();
  const elapsed = (): number => performance.now() - run.flags.startedAt;
  try {
    const value = await Promise.race([fn(run.view), run.abandoned]);
    return { ok: true, value, durationMs: elapsed() };
  } catch (error) {
    return { ok: false, error, durationMs: elapsed() };
  } finally {
    run.flags.inProgress = false;
  }
}

/** Pending stream text, the value, the container's DOM, then the status. */
async function settle(state: RealmState, run: Run, outcome: Outcome): Promise<void> {
  if (run.flags.stale) return;
  run.streams.flush();
  if (outcome.ok && outcome.value !== undefined) {
    run.report(valueOutput(outcome.value, run.limits.maxValueBytes));
  }
  const container = run.flags.usedContainer ? state.containers.get(run.cell) : undefined;
  if (container) run.report({ kind: "dom", ...domSnapshot(container) });
  await state.reports.status({
    execution: run.execution,
    status: outcome.ok ? "ok" : "error",
    durationMs: outcome.durationMs,
    defines: [...run.defines].sort(),
    ...(outcome.ok ? {} : { error: state.context.errorInfo(outcome.error) }),
  });
}

/**
 * Resolves `{}` once the run settled and its status report was answered; before attach it is RealmNotAttached. A name
 * the daemon could not bind and the page does not resolve ends the run in error before it starts: the cell's previous
 * run, its container and its timers stay as they were.
 */
export async function execute(
  state: RealmState,
  params: RealmExecute,
): Promise<Record<string, never>> {
  if (state.attachment.realmId === undefined) {
    throw new RealmNotAttached({ notebook: state.options.notebook });
  }
  const fn = compile(params.code);
  if (params.env) state.env.replace(params.env);
  state.files.register(params.cell, params.map);
  const refusal = refusalOf(state.record, params.unbound);
  if (refusal !== undefined) {
    const { execution } = params;
    // no `defines`: the cell's previous run stays in effect in the page, and so do its names in the daemon's record
    await state.reports.status({ execution, status: "error", durationMs: 0, error: refusal });
    return {};
  }
  const run = prepare(state, params);
  exposeView(run.view);
  await settle(state, run, await evaluate(run, fn));
  return {};
}
