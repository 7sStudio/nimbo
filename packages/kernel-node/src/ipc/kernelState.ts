// What a NodeKernel knows about its child (04-kernel §2.1, §6): the fork, the started session, the death, the export
// and route tables, the sends held back while an interrupt is pending (interrupting.ts sends the interrupts); the
// kernel's messages routed to executions, requests and callbacks; the exit failing them all.
import type { ExecutionId, Route } from "@jsnb/core";
import { InvalidParams, KernelDead } from "@jsnb/core";

import type { Exit, Forked } from "./childProcess.js";
import type { Executions } from "./executions.js";
import type { Cdp } from "./inspector.js";
import type { InterruptRefusal } from "./interrupt.js";
import type { NodeKernelOptions } from "./kernelOptions.js";
import type { DaemonMessage, ExportEntry, KernelMessage } from "./messages.js";
import { notice } from "./notice.js";
import type { Requests } from "./requests.js";

type Ready = Extract<KernelMessage, { type: "ready" }>;

/** The slice of the child process a session sends through. */
type Channel = {
  send(message: DaemonMessage, callback: (error: Error | null) => void): boolean;
};

/** A started kernel: its process, its `ready` and the CDP session interrupt and the debugger use. */
export type Session = { readonly child: Channel; readonly ready: Ready; readonly cdp: Cdp };

type State = {
  forked: Forked | undefined;
  session: Session | undefined;
  death: KernelDead | undefined;
  /** stop() or kill() was called: nothing reports the exit to onExit. */
  ended: boolean;
  exports: readonly ExportEntry[];
  routes: readonly Route[];
  /** Sends held back until every pending interrupt is answered; undefined when none is pending. */
  held: DaemonMessage[] | undefined;
  /** An evaluate of the interrupt hook was sent and is not answered yet. */
  interrupting: boolean;
  /** The interrupts asked for meanwhile, sent in one evaluate once that one is answered, with who waits on them. */
  queued: QueuedInterrupts | undefined;
};

/** Waits on an evaluate of the interrupt hook: its refusal, or undefined when it refused nothing. */
export type InterruptWaiter = (refusal: InterruptRefusal | undefined) => void;

/** The interrupts asked for while an evaluate was pending: their executions and the callers waiting on them. */
export type QueuedInterrupts = {
  readonly executions: ExecutionId[];
  readonly waiters: InterruptWaiter[];
};

/**
 * The kernel log's redaction, which the package root composes (04-kernel §10): `chunk` before each chunk the child
 * writes to a pipe and `refresh` when an `execute` leaves for the kernel (the redactor may rebuild from .env, and gives
 * back a notice for the log when it could not), `line` on every line handed to onLog.
 */
export type LogFilter = {
  readonly chunk: () => string | undefined;
  readonly refresh: () => string | undefined;
  readonly line: (text: string) => string;
};

export type Context = {
  readonly options: NodeKernelOptions;
  readonly state: State;
  readonly executions: Executions;
  readonly requests: Requests;
  /** Hands a line to onLog, redacted. */
  readonly log: (line: string) => void;
  /** Called before each chunk of the child's stdout and stderr. */
  readonly chunk: () => void;
  /** Called when an `execute` leaves for the kernel, which reads .env again then. */
  readonly refresh: () => void;
};

/** A context with nothing started yet. */
export function createContext(
  options: NodeKernelOptions,
  executions: Executions,
  requests: Requests,
  logFilter: LogFilter,
): Context {
  const state: State = {
    ...{ forked: undefined, session: undefined, death: undefined },
    ...{ ended: false, exports: [], routes: [] },
    ...{ held: undefined, interrupting: false, queued: undefined },
  };
  const log = (line: string): void => options.onLog?.(logFilter.line(line));
  const logged = (line: string | undefined): void => {
    if (line !== undefined) log(line);
  };
  const chunk = (): void => {
    logged(logFilter.chunk());
  };
  const refresh = (): void => {
    logged(logFilter.refresh());
  };
  return { options, state, executions, requests, log, chunk, refresh };
}

/** The started session; KernelDead before start() resolved, after stop() or kill(), or after the child died. */
export function live(context: Context): Session {
  const { session, death } = context.state;
  if (session) return session;
  throw death ?? new KernelDead();
}

/**
 * Sends `message` to the child now; a failed send is a log notice. Node serializes the message before it writes it and
 * throws for a value it cannot clone (a function among a call's arguments, in an execute's bindings): that message's
 * request or execution then fails with InvalidParams, and nothing else is lost, also when the send was held behind an
 * interrupt and goes out from the evaluate's answer.
 */
export function write(context: Context, session: Session, message: DaemonMessage): void {
  try {
    session.child.send(message, (error) => {
      if (error) context.log(notice("a message to the kernel failed", { error: error.message }));
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const failure = new InvalidParams({
      issues: [{ path: [], message: `cannot be sent to the kernel: ${reason}` }],
    });
    if ("id" in message) context.requests.fail(message.id, failure);
    else if (message.type === "execute") context.executions.failOne(message.execution, failure);
    else context.log(notice("a message to the kernel could not be sent", { error: reason }));
  }
}

/** Sends `message` to the child, or holds it while an interrupt is pending; a failed send is a log notice. */
export function send(context: Context, session: Session, message: DaemonMessage): void {
  const { held } = context.state;
  if (held) held.push(message);
  else write(context, session, message);
}

/** Calls `method` without waiting for its answer; a failure is a log notice. */
export function fire(context: Context, cdp: Cdp, method: string): void {
  void cdp.send(method).catch((error: unknown) => {
    context.log(notice(`the inspector call ${method} failed`, { error: String(error) }));
  }); // nothing waits on it: a failure is only worth the log
}

type OutputMessage = Extract<KernelMessage, { type: "output" }>;

function onOutput(context: Context, message: OutputMessage): void {
  if (context.executions.output(message) !== "late") return;
  const { execution, output, full } = message;
  context.options.onOutput?.(full ? { execution, output, full } : { execution, output });
}

/** The kernel's tables, kept for later readers and passed on. */
function onTables(
  context: Context,
  message: Extract<KernelMessage, { type: "exports" | "routes" | "events" }>,
): void {
  const { options, state } = context;
  if (message.type === "exports") {
    state.exports = message.names;
    options.onExports?.(message.names);
  } else if (message.type === "routes") {
    state.routes = message.routes;
    options.onRoutes?.(message.routes);
  } else options.onEvents?.({ events: message.events, dropped: message.dropped });
}

/** Routes one validated kernel message. */
export function receive(context: Context, message: KernelMessage): void {
  switch (message.type) {
    case "output":
      onOutput(context, message);
      return;
    case "status":
      context.executions.status(message);
      return;
    case "result":
      context.requests.settle(message);
      return;
    case "exports":
    case "routes":
    case "events":
      onTables(context, message);
      return;
    case "ready":
      context.log(notice("a second ready message was ignored", { pid: message.pid }));
  }
}

/** The child exited: everything waiting on it fails with KernelDead; onExit hears of it unless stop() or kill() caused it. */
export function died(context: Context, exit: Exit): void {
  const { state } = context;
  const error = new KernelDead(exit);
  const wasLive = state.session !== undefined;
  state.session?.cdp.close();
  state.session = undefined;
  state.death = error;
  state.exports = [];
  state.routes = [];
  context.executions.fail(error);
  context.requests.failAll(error);
  if (wasLive && !state.ended) context.options.onExit?.(exit);
}
