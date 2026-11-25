// The daemon's handle on a server-realm kernel (04-kernel §2, §6, §11): createNodeKernel starts the child once,
// feeds execute() iterations from its messages, answers requests by id, interrupts through the inspector, stops it.
import type { Kernel, Route } from "@jsnb/core";
import { InterruptRefused } from "@jsnb/core";

import type { Exit } from "./childProcess.js";
import { killChild, stopChild } from "./ending.js";
import { createExecutions } from "./executions.js";
import type { NodeKernelOptions, ResolvedOptions } from "./kernelOptions.js";
import { resolveOptions } from "./kernelOptions.js";
import type { KernelRequests } from "./kernelRequests.js";
import { kernelRequests } from "./kernelRequests.js";
import type { Context, LogFilter } from "./kernelState.js";
import { requestInterrupt } from "./interrupting.js";
import { createContext, died, fire, live, receive, send } from "./kernelState.js";
import { launch } from "./launch.js";
import type { ExportEntry } from "./messages.js";
import { checkedMessage } from "./messages.js";
import { createRequests } from "./requests.js";

export type NodeKernel = Kernel &
  KernelRequests & {
    /** The child's pid while it runs. */
    readonly pid: () => number | undefined;
    readonly inspectorUrl: () => string | undefined;
    /** True while the kernel is paused in the debugger (Debugger.paused, 04-kernel §9). */
    readonly paused: () => boolean;
    /** Resumes a paused kernel through the daemon's own inspector session: the debugger that paused it is gone. */
    readonly resume: () => void;
    /** The current export table: each exported name and the cell that exported it. */
    readonly exports: () => readonly ExportEntry[];
    readonly routes: () => readonly Route[];
    /** Whether a page holds the client realm: without one, `emit` drops at once (05-bridge §6). */
    readonly listening: (listening: boolean) => void;
    /** SIGKILL now; like stop(), idempotent and never reported to onExit. */
    readonly kill: () => Promise<void>;
  };

async function begin(
  context: Context,
  resolved: ResolvedOptions,
): Promise<{ readonly inspectorUrl?: string }> {
  const { state, options } = context;
  const session = await launch(resolved, {
    onLog: context.log,
    onChunk: context.chunk,
    onMessage: (message) => {
      receive(context, message);
    },
    onPause: (paused) => options.onPause?.(paused),
    onFork: (forked) => {
      state.forked = forked;
      void forked.exited.then((exit: Exit) => {
        died(context, exit);
      }); // exited never rejects
    },
    ended: () => state.ended,
  });
  if (state.death) {
    session.cdp.close();
    throw state.death;
  }
  state.session = session;
  send(context, session, { type: "page", listening: options.pageListening?.() ?? true });
  const { inspectorUrl } = session.ready;
  return inspectorUrl === undefined ? {} : { inspectorUrl };
}

/**
 * The interrupt of 04-kernel §6: every live execution ends `interrupted` now, the kernel's interrupt hook gets their
 * ids (later sends wait for its answer), then Debugger.resume when paused, where the hook's termination takes effect.
 * Settles once the hook answered: rejects InterruptRefused when it refused to stop the user code that runs, in a
 * context Node entered from JavaScript, which keeps running.
 */
async function interrupt(context: Context): Promise<void> {
  const { cdp } = live(context);
  const answered = requestInterrupt(context, cdp, context.executions.interrupt());
  if (cdp.paused()) fire(context, cdp, "Debugger.resume");
  const refusal = await answered;
  if (refusal !== undefined) throw new InterruptRefused(refusal);
}

/**
 * A kernel for the notebook of `options`, not started, its log lines passed through `logFilter`; InvalidParams for a
 * notebook ref that names no notebook. The package root composes it with the log's redaction (createNodeKernel).
 */
export function createKernel(options: NodeKernelOptions, logFilter: LogFilter): NodeKernel {
  const resolved = resolveOptions(options);
  const executions = createExecutions(() => performance.now());
  const context = createContext(options, executions, createRequests(), logFilter);
  let started: Promise<{ readonly inspectorUrl?: string }> | undefined;
  let stopped: Promise<void> | undefined;
  /** A start under way, settled either way: stop() and kill() resolve only once it is, so no child outlives them. */
  const startSettled = async (): Promise<void> => {
    await started?.catch(() => undefined);
  };
  return {
    start: () => (started ??= begin(context, resolved)),
    execute: (req) => {
      const session = live(context);
      checkedMessage({ type: "execute", ...req });
      const events = executions.open(req.execution);
      context.refresh(); // the kernel reads .env again before this run: so does the log's redaction
      send(context, session, { type: "execute", ...req });
      return events;
    },
    ...kernelRequests(context),
    interrupt: () => interrupt(context),
    stop: () => (stopped ??= stopChild(context, resolved.stopTimeoutMs).then(startSettled)),
    kill: () => killChild(context).then(startSettled),
    pid: () => context.state.session?.ready.pid,
    inspectorUrl: () => context.state.session?.ready.inspectorUrl,
    paused: () => context.state.session?.cdp.paused() ?? false,
    resume: () => {
      const cdp = context.state.session?.cdp;
      if (cdp?.paused() === true) fire(context, cdp, "Debugger.resume");
    },
    exports: () => context.state.exports,
    routes: () => context.state.routes,
    listening: (listening) => {
      const { session } = context.state;
      if (session) send(context, session, { type: "page", listening });
    },
  };
}
