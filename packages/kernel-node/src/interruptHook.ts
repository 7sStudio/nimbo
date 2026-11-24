// The kernel's interrupt hook (04-kernel §6). The daemon calls it through Runtime.evaluate with the executions it
// ended; the hook remembers them, so a run of one never calls its cell, and terminates the running JavaScript through a
// same-thread inspector session only when user code is on the stack at that very interrupt point (stackReads.ts) and
// runs in a context a termination leaves intact: in one Node entered from JavaScript (a raw timer, immediate or
// nextTick callback, an AsyncResource scope, a promise job under an async hook) it terminates nothing and answers
// which, with the cell whose frame it found (asyncContexts.ts). Code outside the cells running with no user code on the
// stack (a workspace module, a package) is never terminated either; the hook names its frames in a kernel log notice.
// The daemon's second call (after an interrupt of live executions, and after an evaluate that failed) terminates only
// code that runs for one of the executions it names, or whose store a call of the hook terminated and that has not
// yielded since. A termination so never lands in the kernel's own code or in Node's bookkeeping, and nothing the hook
// reads runs a cell's code: its checks go through descriptors and captured intrinsics.
import { Session } from "node:inspector";

import type { CellId, InterruptContext } from "@jsnb/core";

import type { InterruptRefusal } from "./ipc/interrupt.js";
import { interruptHookName } from "./ipc/interrupt.js";
import { createRecent } from "./recent.js";
import type { Store } from "./store.js";

/** The hook's key on `process`: a symbol, so user code neither replaces it nor sees it in a key listing. */
export const interruptKey = Symbol.for(interruptHookName);

/** How many interrupted executions are remembered, as on the daemon side (04-kernel §6). */
const remembered = 1000;

const isExecutionId = (value: unknown): value is string => typeof value === "string";

export type Interrupts = {
  /** True for an execution the daemon ended as interrupted: its run must not call the cell. */
  readonly has: (execution: string) => boolean;
  /**
   * The hook: remembers `executions` (the ids the daemon ended) and terminates when user code is running in a context
   * a termination leaves intact; `again` (the daemon's second call) only when that code runs for one of them, or a call
   * of the hook terminated its store and it has not yielded since. Answers what it refused to stop, when it refused.
   */
  readonly interrupt: (executions: unknown, again?: unknown) => InterruptRefusal | undefined;
};

export type InterruptDeps = {
  /** True when user code is on the current synchronous stack. */
  readonly userCodeRunning: () => boolean;
  /** The frames of code outside the cells, the kernel and Node on the current synchronous stack, innermost first. */
  readonly outsideFrames: () => readonly string[];
  /** Writes the kernel log notice that an interrupt leaves code outside the cells running, naming its `frames`. */
  readonly reportOutside: (frames: readonly string[]) => void;
  /** The context Node entered from JavaScript that the code running now is in, if any (asyncContexts.ts). */
  readonly pushedContext: () => InterruptContext | undefined;
  /** The cell of the innermost cell frame on the current synchronous stack, if any. */
  readonly runningCell: () => CellId | undefined;
  /** The store of the code running now (its execution, and the run or request it belongs to), if any. */
  readonly runningStore: () => Store | undefined;
  /** Requests the termination of the JavaScript running now. */
  readonly terminate: () => void;
  /** Runs `forget` at the event loop's next check phase (one of the kernel's captured setImmediates). */
  readonly afterYield: (forget: () => void) => void;
};

/** The stores of the code the hook terminated, each one until that code has yielded. */
type Terminated = {
  readonly has: (store: Store) => boolean;
  readonly add: (store: Store) => void;
};

/**
 * The stores of the code the hook terminated (a run's, which its timers and continuations share, or a request's), each
 * remembered until that code has yielded: `afterYield` forgets it at the next check phase, which comes only once the
 * terminated code has stopped, never while it spins on because another evaluate took the termination. A store
 * terminated again before then keeps its one pending forget.
 */
function terminatedStores(afterYield: InterruptDeps["afterYield"]): Terminated {
  const stores = new Set<Store>();
  return {
    has: (store) => stores.has(store),
    add: (store) => {
      if (stores.has(store)) return;
      stores.add(store);
      afterYield(() => {
        stores.delete(store);
      });
    },
  };
}

/**
 * The context of the user code found running. A check that throws refuses: it reads a resource only on a non-zero async
 * id, so whatever made it throw is a context Node entered from JavaScript, where no termination is safe.
 */
function contextNow(deps: InterruptDeps): InterruptContext | undefined {
  try {
    return deps.pushedContext();
  } catch {
    return "AsyncResource";
  }
}

/**
 * User code found running, under `store`: terminated where it can be, its store remembered in `terminated` until it
 * yields; else the refusal, with the cell whose frame is found.
 */
function stopUserCode(
  deps: InterruptDeps,
  store: Store | undefined,
  terminated: Terminated,
): InterruptRefusal | undefined {
  const context = contextNow(deps);
  if (context === undefined) {
    // Remembered first, since the termination can end the rest of this call: a later evaluate can take the termination
    // in this code's place (V8 then cancels it), and the daemon's second call stops this code then.
    if (store !== undefined) terminated.add(store);
    // Decided and requested at this one interrupt point, so the termination lands in the user code found here.
    deps.terminate();
    return undefined;
  }
  const cell = deps.runningCell();
  return cell === undefined ? { context } : { context, cell };
}

/** No user code running: nothing is terminated, and code outside the cells found running is named in the log. */
function reportOutside(deps: InterruptDeps): void {
  const frames = deps.outsideFrames();
  if (frames.length > 0) deps.reportOutside(frames);
}

/**
 * True when the daemon's second call may stop the code running under `store`: code of an execution the call names, or
 * code whose store a call of the hook terminated and that has not yielded since (it spins on because another evaluate
 * took the termination). Code of that run or request that runs once the store is forgotten is left alone; what runs
 * after the code yielded but before that check phase is not (its timers or handlers due by then, within one turn of
 * the event loop). Every request runs under a store of its own, so one queued behind the interrupted code is stopped
 * only when it runs for an execution the call names.
 */
const secondCallStops = (
  store: Store | undefined,
  ids: readonly string[],
  terminated: Terminated,
): boolean => store !== undefined && (ids.includes(store.execution) || terminated.has(store));

/** The interrupted executions, the last 1 000, and the hook that adds to them over `deps`. */
export function createInterrupts(deps: InterruptDeps): Interrupts {
  const interrupted = createRecent<string>(remembered);
  const terminated = terminatedStores(deps.afterYield);
  return {
    has: interrupted.has,
    interrupt: (executions, again) => {
      // Remembered whatever the hook finds, a refusal included: a run of one must never call its cell.
      const ids = Array.isArray(executions) ? executions.filter(isExecutionId) : [];
      for (const execution of ids) interrupted.add(execution);
      // The second call stops only what it may: by then the kernel may run a request's code.
      const store = deps.runningStore();
      if (again === true && !secondCallStops(store, ids, terminated)) return undefined;
      if (deps.userCodeRunning()) return stopUserCode(deps, store, terminated);
      // Once per interrupt: a second call that finds the same code says nothing more.
      if (again !== true) reportOutside(deps);
      return undefined;
    },
  };
}

/** Terminates the running JavaScript through a same-thread inspector session, connected now, before any interrupt. */
export function connectTerminate(): () => void {
  const session = new Session();
  session.connect();
  return () => {
    session.post("Runtime.terminateExecution");
  };
}

/** Defines `hook` on `target` under interruptKey: not writable, not configurable, not enumerable. */
export function installHook(
  target: object,
  hook: (executions: unknown, again?: unknown) => InterruptRefusal | undefined,
): void {
  Object.defineProperty(target, interruptKey, {
    value: hook,
    writable: false,
    configurable: false,
    enumerable: false,
  });
}
