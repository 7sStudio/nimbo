// The interrupts of 04-kernel §6 as the daemon sends them: evaluates of the kernel's interrupt hook, one at a time, the
// sends to the child held until the last one answered (kernelState.ts holds them), each interrupt settled with the
// hook's refusal, or nothing, once its own evaluates answered.
import type { ExecutionId } from "@jsnb/core";

import type { Cdp } from "./inspector.js";
import type { InterruptRefusal } from "./interrupt.js";
import { interruptCall, refusalOf } from "./interrupt.js";
import type { Context, InterruptWaiter, QueuedInterrupts } from "./kernelState.js";
import { write } from "./kernelState.js";
import { notice } from "./notice.js";

/** How many second calls one interrupt sends at most, each after the one before failed (04-kernel §6). */
const secondCalls = 5;

/**
 * True when a second call follows an answered evaluate: after a first call that ended live executions, after any
 * evaluate that failed (a second call a few times at most), and never after a refusal.
 */
function secondCallDue(
  executions: readonly ExecutionId[],
  again: number,
  failed: boolean,
  refusal: InterruptRefusal | undefined,
): boolean {
  if (refusal !== undefined) return false;
  if (again === 0) return failed || executions.length > 0;
  return failed && again < secondCalls;
}

/** Settles the interrupts an evaluate carried with the hook's refusal, or nothing. */
function settle(waiters: readonly InterruptWaiter[], refusal: InterruptRefusal | undefined): void {
  for (const waiter of waiters) waiter(refusal);
}

/**
 * One evaluate of the interrupt hook at a time (04-kernel §6). A second evaluate that the kernel's inspector dispatches
 * beside the first runs while the first one's termination is pending, is terminated itself, and V8 then cancels the
 * termination: two interrupts in a row left `while (true) {}` running and the kernel answering nothing. So the
 * interrupts asked for while one is answered go in one evaluate after it, and the held sends go out after the last.
 * An evaluate that ended live executions, and refused nothing, is followed by a second call with the same executions
 * (`again` counts them): another inspector client's evaluate run right behind the first can take its termination in
 * the cell's place, and the second call stops the cell then. It stops only code that runs for those executions, or
 * code a call of the hook terminated that has not yielded since (by its store), so a request to another cell's export
 * queued behind the cell, whose user code may be running by then, is never stopped by it. Any evaluate the daemon sends
 * can itself reach the kernel while the one before it still has its termination pending and take it, the interrupts
 * asked for meanwhile and a second call alike; it then fails, so every evaluate that fails is followed by a second call,
 * sent again when it fails, a few times at most. The interrupts an evaluate carries settle once their last evaluate answered, with its refusal, if any (a
 * refusal ends the calls); when interrupts asked for meanwhile wait, their evaluate replaces the second call, since it
 * stops whatever user code runs.
 */
function evaluateHook(context: Context, cdp: Cdp, carried: QueuedInterrupts, again = 0): void {
  const { state } = context;
  const { executions, waiters } = carried;
  const answered = (failed: boolean, refusal: InterruptRefusal | undefined): void => {
    const { queued } = state;
    state.queued = undefined;
    if (queued && state.session) {
      settle(waiters, refusal);
      evaluateHook(context, cdp, queued);
      return;
    }
    if (secondCallDue(executions, again, failed, refusal) && state.session) {
      evaluateHook(context, cdp, carried, again + 1);
      return;
    }
    settle(waiters, refusal);
    // A kernel gone meanwhile stops nothing more: the interrupts asked for meanwhile settle too.
    if (queued) settle(queued.waiters, undefined);
    state.interrupting = false;
    const held = state.held ?? [];
    state.held = undefined;
    const { session } = state;
    if (session) for (const message of held) write(context, session, message);
  };
  void cdp.send("Runtime.evaluate", interruptCall(executions, again > 0)).then(
    (answer) => {
      answered(false, refusalOf(answer));
    },
    (error: unknown) => {
      context.log(notice("the inspector call Runtime.evaluate failed", { error: String(error) }));
      answered(true, undefined);
    },
  ); // the answer, or the failure, sends what comes next
}

/**
 * The interrupt of 04-kernel §6: a Runtime.evaluate that calls the kernel's interrupt hook with the executions the
 * daemon ended. The hook terminates only user code, and its own evaluation may be terminated with it, so its answer,
 * a result or an error, means delivered: every send waits until each pending interrupt is answered, so an execution
 * the hook remembers never reaches the kernel first. A failed or closed session releases them too. Resolves with the
 * hook's refusal, or undefined when it refused nothing, once the evaluates that carry these executions answered.
 */
export function requestInterrupt(
  context: Context,
  cdp: Cdp,
  executions: readonly ExecutionId[],
): Promise<InterruptRefusal | undefined> {
  const { state } = context;
  state.held ??= [];
  return new Promise((resolve) => {
    if (state.interrupting) {
      const queued = (state.queued ??= { executions: [], waiters: [] });
      queued.executions.push(...executions);
      queued.waiters.push(resolve);
      return;
    }
    state.interrupting = true;
    evaluateHook(context, cdp, { executions: [...executions], waiters: [resolve] });
  });
}
