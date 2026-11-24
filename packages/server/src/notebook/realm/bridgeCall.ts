// bridge.call of 05-bridge §4 (03-api §4.5): only a current server export is callable; the kernel runs it under the
// defining cell, with bridge.rpcTimeoutMs; the answer is `{ result, redacted }` (the kernel's redaction flag). A throw,
// a name that is no current export (as a client run's resolution says: ExportNotRun, KernelRestarted, NotExported) and
// a timeout (RpcTimeout) are BRIDGE_CALL_FAILED with the ErrorInfo. Calls are not queued behind the runs, so a call
// can find its export's cell running again: the kernel refuses it until that run makes it, and the answer is the same.
import type { CellId } from "@jsnb/core";
import {
  BridgeCallFailed,
  JsnbError,
  KernelRestarted,
  NotExported,
  RpcTimeout,
  toErrorInfo,
} from "@jsnb/core";
import { CallRefused } from "@jsnb/kernel-node";

import { KernelRequestTimedOut, withTimeout } from "../../kernel/requests.js";
import type { SessionContext } from "../session/context.js";
import { missingExport, placeOf, serverDefiner, serverExporter } from "./names.js";
import type { RealmState } from "./state.js";

/** A bridge call to a name no server cell of the notebook defines. */
class NoSuchExport extends JsnbError {
  declare readonly data: { readonly name: string; readonly notebook: string };
  constructor(data: { readonly name: string; readonly notebook: string }) {
    super({
      name: "NoSuchExport",
      message: `${data.name} is not exported by any server cell of ${data.notebook}. Export it from a server cell to call it from the page.`,
      data,
    });
  }
}

/** A failure of the daemon's own (no current export, a timeout, a dead kernel) as the page reads it: its name, message
 * and data, `raw` without the daemon's stack. A server function's own error comes from the kernel as it threw it. */
function failed(error: unknown): BridgeCallFailed {
  const info = toErrorInfo(error);
  return new BridgeCallFailed({ error: { ...info, raw: `${info.name}: ${info.message}` } });
}

/** Why `fn` cannot be called while the kernel holds no export of it: a server cell's source exports it (ExportNotRun,
 * or KernelRestarted when a restart lost it), defines it unexported (NotExported), or none does. */
function notCallable(context: SessionContext, state: RealmState, fn: string): JsnbError {
  const exporter = serverExporter(context, fn);
  if (exporter) return missingExport(state, fn, exporter);
  const definer = serverDefiner(context, fn);
  if (definer) return new NotExported({ name: fn, cell: definer.cell, index: definer.index });
  return new NoSuchExport({ name: fn, notebook: context.ref });
}

/** A held stub's export that is a value now (`export const price = 5` where a function was): the page's stub is stale. */
function notAFunction(context: SessionContext, state: RealmState, fn: string, cell: CellId): Error {
  const index = placeOf(context, cell);
  if (index === undefined) return notCallable(context, state, fn);
  return new TypeError(
    `${fn} is no longer a function on the server: server cell ${String(index)} exports a value under that name now. Run the client cell that uses it again to read it.`,
  );
}

/** What the page reads for a call the kernel refused before running anything (CallRefused): its export's cell runs
 * again and has not made it yet, or ended before reaching it, as a client run would read it; or it is a value now. */
const refusal = (
  context: SessionContext,
  state: RealmState,
  refused: CallRefused,
  call: { readonly fn: string; readonly cell: CellId },
): Error =>
  refused.data.reason === "value"
    ? notAFunction(context, state, call.fn, call.cell)
    : notCallable(context, state, call.fn);

export type CallAnswer = { readonly result: unknown; readonly redacted?: boolean };

/** A call a kernel restart cut: KernelRestarted naming the cell that exported `fn`, or why it cannot be called now when
 * that cell is gone. */
function restartedCall(
  context: SessionContext,
  state: RealmState,
  fn: string,
  cell: CellId,
): JsnbError {
  const index = placeOf(context, cell);
  return index === undefined
    ? notCallable(context, state, fn)
    : new KernelRestarted({ name: fn, cell, index });
}

/**
 * Calls the current export `fn` with `args` (their wire form, encoded strictly by the page's stub). A call a kernel
 * restart cut (sent to the kernel it killed, or waiting for the new one, which has no export yet) is KernelRestarted;
 * a kernel that died on its own stays KernelDead.
 */
export async function bridgeCall(
  context: SessionContext,
  state: RealmState,
  fn: string,
  args: readonly unknown[],
): Promise<CallAnswer> {
  const entry = state.exports.find((each) => each.name === fn);
  if (entry === undefined) throw failed(notCallable(context, state, fn));
  const restarts = context.runs.restarts;
  const registered = context.kernel.live(); // the kernel this registry is of: none while a restart replaces it
  const cut = (): BridgeCallFailed => failed(restartedCall(context, state, fn, entry.cell));
  const timeoutMs = context.settings()["bridge.rpcTimeoutMs"];
  try {
    const kernel = await context.kernel.running(); // a dead kernel is the call's KernelDead, never a new kernel
    if (context.runs.restarts !== restarts || kernel !== registered) throw cut();
    const maxBytesPerValue = context.settings()["bridge.maxBytesPerValue"]; // the setting now, not the launch one
    const answer = await withTimeout(
      "call",
      timeoutMs,
      (signal) => kernel.call(fn, args, { signal, maxBytesPerValue }),
      { pauses: context.kernel.pauses },
    );
    return answer.redacted ? { result: answer.value, redacted: true } : { result: answer.value };
  } catch (error) {
    if (error instanceof BridgeCallFailed) throw error;
    if (error instanceof KernelRequestTimedOut)
      throw failed(new RpcTimeout({ name: fn, args, timeoutMs }));
    if (context.runs.restarts !== restarts) throw cut();
    if (error instanceof CallRefused)
      throw failed(refusal(context, state, error, { fn, cell: entry.cell }));
    throw failed(error);
  }
}
