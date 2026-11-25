// The kernel child (04-kernel §2): Node's own process.nextTick and process.emit captured and checked four times a
// second (§3.3), the config from argv[2], the runtime over the workspace (.env read at start), stdout and stderr routed
// to the sink, the message and error listeners, the disconnect listener that ends the kernel's process group once the
// daemon is gone, the interrupt hook on the process and Node's lazy globals warmed up (04-kernel §6), then `ready` with
// the pid and the inspector URL. Everything takes the process as a parameter, so tests run it with a fake one.
import { url } from "node:inspector";

import { departure } from "./departure.js";
import { createChannel } from "./ipc/channel.js";
import { ChildConfig } from "./ipc/messages.js";
import { notice } from "./ipc/notice.js";
import type { PatchableStream, StdioTake } from "./outputs/stdio.js";
import { patchStdio } from "./outputs/stdio.js";
import type { Runtime } from "./runtime.js";
import { startUserCode, userCodeFrame } from "./builtins/userCode.js";
import { pushedContext } from "./asyncContexts.js";
import { connectTerminate, createInterrupts, installHook } from "./interruptHook.js";
import { cellOnStack, outsideFramesOnStack, userCodeOnStack } from "./stackReads.js";
import { ownCodeDirectories } from "./kernelFiles.js";
import { captureProcessHooks } from "./processHooks.js";
import { createRuntime } from "./runtime.js";
import { warmUp } from "./warmUp.js";

type Listener = (...args: unknown[]) => void;

/** The slice of `process` the kernel uses. */
export type KernelProcess = {
  readonly argv: readonly string[];
  readonly env: Record<string, string | undefined>;
  readonly pid: number;
  readonly platform: string;
  readonly cwd: () => string;
  readonly stdout: PatchableStream;
  readonly stderr: PatchableStream;
  on(
    event: "message" | "uncaughtException" | "unhandledRejection" | "disconnect",
    listener: Listener,
  ): unknown;
  prependListener(event: "message", listener: Listener): unknown;
  removeListener(event: "message", listener: Listener): unknown;
  send?(message: unknown, callback?: (error: Error | null) => void): boolean;
  kill(pid: number, signal: string): unknown;
  exit(code?: number): void;
};

/** What tests replace; production takes the defaults. */
type StartOptions = {
  readonly load?: (url: string) => Promise<unknown>;
  readonly schedule?: (flush: () => void) => void;
  readonly defer?: (turn: () => void) => void;
  readonly clock?: () => string;
  /** Loads Node's lazy globals before `ready`. */
  readonly warmUp?: () => Promise<void>;
  /** What the interrupt hook calls to terminate user code: a same-thread inspector session in production. */
  readonly terminate?: () => void;
  /** Runs `check` every `ms`: the periodic process-hook check, an unref'd interval of the captured setInterval. */
  readonly every?: (ms: number, check: () => void) => void;
};

/**
 * The timers the kernel schedules its own work with and the Date its clock reads, captured when the module loads,
 * before any cell runs: a cell that replaces globalThis.setImmediate, setTimeout or Date (fake timers do) breaks its
 * own code, not the kernel's inbox, flush or timestamps (04-kernel §3.3).
 */
const {
  setImmediate: nextTurn,
  setTimeout: later,
  setInterval: repeat,
  Date: NativeDate,
} = globalThis;

/**
 * The sink's flush timer of 04-kernel §5.1: 16 ms. The flush is the kernel's own code, which the interrupt hook never
 * terminates, so it runs in the timer itself: as a microtask it could be dropped with a terminated cell's (§6).
 */
const flushLater = (flush: () => void): void => {
  later(flush, 16).unref();
};

/**
 * How often the kernel compares the process hooks with Node's own besides after the code it starts (04-kernel §3.3): a
 * hook replaced by code it did not start (a raw timer's) is put back within this long, rather than at the next interrupt.
 */
const hookCheckMs = 250;

/** Runs `check` every `ms` on a timer that never keeps the kernel alive. */
const checkEvery = (ms: number, check: () => void): void => {
  repeat(check, ms).unref();
};

function listen(proc: KernelProcess, runtime: Runtime, depart: () => void): void {
  proc.on("message", (message) => {
    runtime.receive(message);
  });
  proc.on("uncaughtException", (error) => {
    runtime.lateError(error);
  });
  proc.on("unhandledRejection", (reason) => {
    runtime.lateError(reason);
  });
  // The daemon is gone: nothing would ever stop this kernel otherwise, nor what its cells started (departure.ts).
  proc.on("disconnect", () => {
    depart();
  });
}

/** Starts the kernel in `proc` (the real `process` in main.ts); resolves once `ready` is sent, after the warm-up. */
export function startKernel(proc: KernelProcess, options: StartOptions = {}): Promise<void> {
  const hooks = captureProcessHooks(proc);
  let take: StdioTake = () => false;
  const stdio = patchStdio(proc, (stream, text) => take(stream, text), startUserCode);
  // Captured now, before any cell runs: a cell that replaces process.send, process.exit or process.kill (departure.ts)
  // breaks its own calls, not the kernel's.
  const send = proc.send?.bind(proc);
  const exit = proc.exit.bind(proc);
  const channel = createChannel(
    (message, callback) => {
      // Node calls a send back through process.nextTick: under Node's own, a cell's fake loses no callback (§3.3).
      if (send) hooks.withNodeNextTick(() => send(message, callback));
      else callback(null);
    },
    (error) => {
      stdio.log("stderr", `${notice("a send failed", { error: error.message })}\n`);
    },
  );
  // The interrupt hook's executions exist before the runtime, which reads them: what the hook reads of the code running
  // now (its store, its cell) and its notices go through `late.runtime`.
  const late: { runtime?: Runtime } = {};
  const frame = userCodeFrame;
  if (frame === undefined) {
    const text =
      "the user-code frame was not found: an interrupt stops cell code only, not the module code a cell calls";
    stdio.log("stderr", `${notice(text)}\n`);
  }
  const interrupts = createInterrupts({
    userCodeRunning: () => userCodeOnStack(frame),
    outsideFrames: () => outsideFramesOnStack(ownCodeDirectories),
    reportOutside: (frames) => late.runtime?.reportOutside(frames),
    pushedContext,
    runningCell: () => cellOnStack((url) => late.runtime?.cellOf(url)),
    runningStore: () => late.runtime?.runningStore(),
    terminate: options.terminate ?? connectTerminate(),
    afterYield: (forget) => {
      nextTurn(forget);
    },
  });
  const runtime = createRuntime({
    config: ChildConfig.parse(JSON.parse(proc.argv[2] ?? "null")),
    workspace: proc.cwd(),
    processEnv: proc.env,
    interrupted: interrupts.has,
    send: channel.send,
    log: stdio.log,
    load: options.load ?? ((specifier) => import(specifier)),
    schedule: options.schedule ?? flushLater,
    defer: options.defer ?? ((turn) => nextTurn(turn)),
    clock: options.clock ?? (() => new NativeDate().toISOString()),
    hooks,
    exit,
    end: (code) => {
      channel.afterLastSend(() => {
        exit(code);
      });
    },
  });
  late.runtime = runtime;
  take = runtime.write;
  listen(proc, runtime, departure(proc, exit));
  (options.every ?? checkEvery)(hookCheckMs, () => {
    runtime.checkHooks();
  });
  installHook(proc, (executions, again) => {
    // Before a termination, which can end the rest of this call: the process hooks a cell may have replaced, the ones
    // kept probed again, since a kept wrapper that stopped delivering leaves the kernel deaf until an interrupt (§3.3).
    runtime.recheckHooks();
    return interrupts.interrupt(executions, again);
  });
  const inspectorUrl = url();
  const ready = (): void => {
    channel.send({ type: "ready", pid: proc.pid, ...(inspectorUrl ? { inspectorUrl } : {}) });
  };
  return (options.warmUp ?? warmUp)().then(ready, (error: unknown) => {
    stdio.log("stderr", `${notice("the warm-up failed", { error: String(error) })}\n`);
    ready();
  });
}
