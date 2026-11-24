// User code as the kernel starts and calls it (04-kernel §6). It starts in a promise job, never through
// queueMicrotask: under an AsyncLocalStorage store, or with an async hook enabled (a debugger's async stack traces),
// Node runs a queueMicrotask callback inside an AsyncResource whose after-hook an interrupt's termination skips, and
// Node then exits ("async hook stack has become corrupted") or aborts. A promise job carries the store through V8 and
// pushes nothing a termination could leave behind. The kernel calls user functions (a bridge call's, a route handler,
// a timer callback, a disposer) through callUserCode, whose frame marks user code for the interrupt hook even when the
// function comes from a workspace module or a package rather than from a cell's code. The Promise and Reflect
// intrinsics used here are captured when the module loads, before any cell runs: a cell that replaces
// Promise.prototype.then, Promise.resolve or Reflect.apply breaks its own code, not the kernel's, and the kernel's
// own promises read no species a cell could replace (04-kernel §3.3).
import { getCallSites } from "node:util";

const { apply, defineProperty } = Reflect;
const NativePromise = Promise;
const nativeThen: unknown = Reflect.get(Promise.prototype, "then");

/**
 * Gives a promise of the kernel's own an own `constructor` of undefined, so `then` makes its derived promise with the
 * intrinsic %Promise% and reads neither Promise.prototype.constructor nor Promise[Symbol.species], which a cell can
 * replace (a throwing species, a constructor that is no object) and so stall every message (04-kernel §3.3).
 */
function speciesFree<T extends Promise<unknown>>(promise: T): T {
  defineProperty(promise, "constructor", { value: undefined });
  return promise;
}

const settled = speciesFree(Promise.resolve());

/** `promise.then(onFulfilled, onRejected)` through the captured then. */
function thenOf(
  promise: Promise<unknown>,
  onFulfilled: ((value: unknown) => void) | undefined,
  onRejected?: (error: unknown) => void,
): void {
  if (typeof nativeThen === "function") apply(nativeThen, promise, [onFulfilled, onRejected]);
}

/** Where a stack frame runs, as getCallSites and V8's CallSite API report it (1-based, before any source map). */
export type FramePosition = {
  readonly scriptName: string;
  readonly lineNumber: number;
  readonly columnNumber: number;
};

/**
 * Calls `fn` with `self` and `args` below the user-code frame, returning what it returns and throwing what it throws.
 * The frame is this function's, at the call below: an ordinary kernel frame (04-kernel §5.3) the hook knows by position.
 */
export function callUserCode(
  fn: (...args: never[]) => unknown,
  self: unknown,
  args: readonly unknown[],
): unknown {
  return apply(fn, self, args);
}

/** The user-code frame's position, read from the stack of a first call, so it holds bundled or minified too. */
function calibrate(): FramePosition | undefined {
  let sites: readonly FramePosition[] = [];
  callUserCode(
    () => {
      sites = getCallSites(4, { sourceMap: false });
    },
    undefined,
    [],
  );
  const [reader, ...below] = sites;
  // The first frame below the reader in the same script is callUserCode's (Reflect.apply leaves no frame).
  const frame = below.find((site) => site.scriptName === reader?.scriptName);
  if (frame === undefined) return undefined;
  const { scriptName, lineNumber, columnNumber } = frame;
  return { scriptName, lineNumber, columnNumber };
}

/** The position of the user-code frame, the same for every call; undefined if the stack could not be read. */
export const userCodeFrame: FramePosition | undefined = calibrate();

/** True when two frames run at the same position. */
export const samePosition = (site: FramePosition, frame: FramePosition): boolean =>
  site.scriptName === frame.scriptName &&
  site.lineNumber === frame.lineNumber &&
  site.columnNumber === frame.columnNumber;

/**
 * Starts `job` in a promise job: code that runs user code, or calls it synchronously (the inbox's dispatch), starts
 * this way, never through queueMicrotask. `job` handles its own errors: a throw would be an unhandled rejection.
 */
export function startUserCode(job: () => void): void {
  thenOf(settled, job);
}

/** Hands a rejection of `value`, when it is a promise, to `report`; a promise returned by user code. */
export function onRejection(value: unknown, report: (error: unknown) => void): void {
  if (value instanceof NativePromise) thenOf(value, undefined, report);
}

/** The same for a promise of the kernel's own (a flow's), species-free like the kernel's resolved promise. */
export function onOwnRejection(value: unknown, report: (error: unknown) => void): void {
  if (value instanceof NativePromise) thenOf(speciesFree(value), undefined, report);
}
