// The live executions of 04-kernel §2.1 and §6 on the daemon side: one async queue per execute() fed by that
// execution's output and status messages and ended by its terminal status, after which its outputs are late (onOutput);
// interrupt ends every live one at once as interrupted, and whatever an interrupted execution reports afterwards is
// dropped (the last 1 000 interrupted are remembered).
import type { ExecutionId, KernelEvent } from "@jsnb/core";

import type { KernelMessage } from "./messages.js";

type OutputMessage = Extract<KernelMessage, { type: "output" }>;
type StatusMessage = Extract<KernelMessage, { type: "status" }>;

type Live = {
  readonly events: KernelEvent[];
  runningAt: number | undefined;
  failure: Error | undefined;
  wake: (() => void) | undefined;
};

export type Executions = {
  /** The events of a new execution, ending after its terminal status. */
  readonly open: (execution: ExecutionId) => AsyncIterable<KernelEvent>;
  /** `live` when an iteration takes it, `late` when none does (onOutput), `dropped` for an interrupted one. */
  readonly output: (message: OutputMessage) => "live" | "late" | "dropped";
  readonly status: (message: StatusMessage) => void;
  /** Ends every live execution as interrupted, now, and returns their ids for the kernel's interrupt hook. */
  readonly interrupt: () => readonly ExecutionId[];
  /** The kernel died: every live iteration throws `error` after its queued events. */
  readonly fail: (error: Error) => void;
  /** `execution`'s message could not be sent: its iteration throws `error` after its queued events. */
  readonly failOne: (execution: ExecutionId, error: Error) => void;
};

const terminal = new Set(["ok", "error", "interrupted"]);
/**
 * How many interrupted executions are remembered. One can report at any later time (a cell awaiting a fetch resumes
 * after the interrupt), so no message tells when it is over: the oldest are forgotten instead, and what one of those
 * still reports is late (onOutput).
 */
const rememberedInterrupts = 1000;

type Context = {
  readonly now: () => number;
  readonly live: Map<ExecutionId, Live>;
  readonly interrupted: Set<ExecutionId>;
};

function push(entry: Live, event: KernelEvent): void {
  entry.events.push(event);
  entry.wake?.();
}

const isTerminal = (event: KernelEvent): boolean =>
  event.kind === "status" && terminal.has(event.status);

/** The next queued event, waiting for one; once the queue is empty a failure is thrown. */
async function next(entry: Live): Promise<KernelEvent> {
  for (;;) {
    const event = entry.events.shift();
    if (event) return event;
    if (entry.failure) throw entry.failure;
    await new Promise<void>((resolve) => {
      entry.wake = resolve;
    });
    entry.wake = undefined;
  }
}

async function* iterate(entry: Live, forget: () => void): AsyncGenerator<KernelEvent> {
  try {
    for (;;) {
      const event = await next(entry);
      yield event;
      if (isTerminal(event)) return;
    }
  } finally {
    forget();
  }
}

function output(
  context: Context,
  { execution, output, full }: OutputMessage,
): "live" | "late" | "dropped" {
  if (context.interrupted.has(execution)) return "dropped";
  const entry = context.live.get(execution);
  if (!entry) return "late";
  push(
    entry,
    full ? { kind: "output", execution, output, full } : { kind: "output", execution, output },
  );
  return "live";
}

function status(context: Context, { execution, status, error, durationMs }: StatusMessage): void {
  if (context.interrupted.has(execution)) return;
  const entry = context.live.get(execution);
  if (!entry) return;
  if (status === "running") entry.runningAt = context.now();
  const event = { kind: "status", execution, status, durationMs } as const;
  push(entry, error ? { ...event, error } : event);
  // Over once its terminal status is queued: what it reports later is late (onOutput), not lost in a finished queue.
  if (terminal.has(status)) context.live.delete(execution);
}

/** Remembers `execution` as interrupted, forgetting the oldest one beyond the limit. */
function remember(context: Context, execution: ExecutionId): void {
  context.interrupted.add(execution);
  if (context.interrupted.size <= rememberedInterrupts) return;
  const oldest = context.interrupted.values().next();
  if (!oldest.done) context.interrupted.delete(oldest.value);
}

function interrupt(context: Context): readonly ExecutionId[] {
  const ended: ExecutionId[] = [];
  for (const [execution, entry] of context.live) {
    remember(context, execution);
    const durationMs = entry.runningAt === undefined ? 0 : context.now() - entry.runningAt;
    push(entry, { kind: "status", execution, status: "interrupted", durationMs });
    context.live.delete(execution);
    ended.push(execution);
  }
  return ended;
}

/** No live executions yet; `now` measures the duration of an interrupted one from its `running`. */
export function createExecutions(now: () => number): Executions {
  const context: Context = { now, live: new Map(), interrupted: new Set() };
  return {
    open: (execution) => {
      const entry: Live = { events: [], runningAt: undefined, failure: undefined, wake: undefined };
      context.live.set(execution, entry);
      return iterate(entry, () => context.live.delete(execution));
    },
    output: (message) => output(context, message),
    status: (message) => {
      status(context, message);
    },
    interrupt: () => interrupt(context),
    failOne: (execution, error) => {
      const entry = context.live.get(execution);
      context.live.delete(execution);
      if (!entry) return;
      entry.failure = error;
      entry.wake?.();
    },
    fail: (error) => {
      for (const entry of context.live.values()) {
        entry.failure = error;
        entry.wake?.();
      }
    },
  };
}
