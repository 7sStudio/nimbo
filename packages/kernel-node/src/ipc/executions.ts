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

/** No live executions yet; `now` measures the duration of an interrupted one from its `running`. */
export function createExecutions(now: () => number): Executions {
  const live = new Map<ExecutionId, Live>();
  const interrupted = new Set<ExecutionId>();

  /** Remembers `execution` as interrupted, forgetting the oldest one beyond the limit. */
  const remember = (execution: ExecutionId): void => {
    interrupted.add(execution);
    if (interrupted.size <= rememberedInterrupts) return;
    const oldest = interrupted.values().next();
    if (!oldest.done) interrupted.delete(oldest.value);
  };

  return {
    open: (execution) => {
      const entry: Live = { events: [], runningAt: undefined, failure: undefined, wake: undefined };
      live.set(execution, entry);
      return iterate(entry, () => live.delete(execution));
    },
    output: ({ execution, output, full }) => {
      if (interrupted.has(execution)) return "dropped";
      const entry = live.get(execution);
      if (!entry) return "late";
      push(
        entry,
        full ? { kind: "output", execution, output, full } : { kind: "output", execution, output },
      );
      return "live";
    },
    status: ({ execution, status, error, durationMs }) => {
      if (interrupted.has(execution)) return;
      const entry = live.get(execution);
      if (!entry) return;
      if (status === "running") entry.runningAt = now();
      const event = { kind: "status", execution, status, durationMs } as const;
      push(entry, error ? { ...event, error } : event);
      // Over once its terminal status is queued: what it reports later is late (onOutput), not lost in a finished queue.
      if (terminal.has(status)) live.delete(execution);
    },
    interrupt: () => {
      const ended: ExecutionId[] = [];
      for (const [execution, entry] of live) {
        remember(execution);
        const durationMs = entry.runningAt === undefined ? 0 : now() - entry.runningAt;
        push(entry, { kind: "status", execution, status: "interrupted", durationMs });
        live.delete(execution);
        ended.push(execution);
      }
      return ended;
    },
    failOne: (execution, error) => {
      const entry = live.get(execution);
      live.delete(execution);
      if (!entry) return;
      entry.failure = error;
      entry.wake?.();
    },
    fail: (error) => {
      for (const entry of live.values()) {
        entry.failure = error;
        entry.wake?.();
      }
    },
  };
}
