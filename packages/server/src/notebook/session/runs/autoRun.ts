// execution.autoRunDependents (04-kernel §4.1): a cell.run that ends well plans its stale dependents, and each time the
// queue has nothing else to run the next of them runs, dependencies first, so whatever anyone asks for meanwhile runs
// before the rest of the cascade. A failure, or a dependent left alone, holds back what depends on it; an edit takes
// the cell out; interrupt, restart and close stop it all. Each cell.run's ticket answers which dependents it started.
import type { AutoRunReport, AutoRunSkip, CellId, Execution } from "@jsnb/core";
import { autoRunOrder, cyclicCells, dependentsOf, nextAutoRun } from "@jsnb/core";

import type { SessionContext } from "../context.js";
import type { CellRecord, ExecutionRecord } from "../records.js";
import { createExecution } from "./executions.js";
import type { QueuedRun, RunQueue } from "./queue.js";
import { queuedRun } from "./queue.js";

type Skip = { readonly cell: CellId; readonly reason: AutoRunSkip; readonly by?: CellId };

/** One cell.run's share of the cascade: its dependents not decided yet, those it started and those it left alone. */
export type Ticket = {
  readonly from: ExecutionRecord;
  readonly undecided: Set<CellId>;
  readonly started: QueuedRun[];
  readonly skipped: Skip[];
  readonly done: Promise<void>;
  readonly settle: () => void;
};

type Pending = { readonly tickets: Ticket[]; readonly last: ExecutionRecord | undefined };

export type AutoRun = {
  /** After every run, before its waiter hears: ends a cascade step, or plans a cell.run's dependents. */
  readonly ended: (run: QueuedRun) => void;
  /** The queue has nothing to run: the next dependent, if any. */
  readonly idle: () => void;
  /** A cell's code changed: it leaves the cascade, and so does what depends on it. */
  readonly edited: (cell: CellId) => void;
  /** Interrupt, restart, close or the setting turned off: every dependent still waiting stays stale. */
  readonly stop: () => void;
  /** The ticket a cell.run's run got, once it ended well with the setting on. */
  readonly ticket: (run: QueuedRun) => Ticket | undefined;
};

type State = {
  readonly context: SessionContext;
  readonly queue: RunQueue;
  readonly realmAttached: () => boolean;
  readonly pending: Map<CellId, Pending>;
  readonly tickets: WeakMap<QueuedRun, Ticket>;
  /** Cells this cascade left alone or whose run failed: what depends on them waits. */
  readonly held: Set<CellId>;
  /** Every cell this cascade planned: one whose latest run did not end well holds its dependents back. */
  readonly seen: Set<CellId>;
  running: { readonly run: QueuedRun; edited: boolean } | undefined;
  shown: string;
  poll: NodeJS.Timeout | undefined;
};

const idleState = JSON.stringify({ running: null, pending: [] });
const pollMs = 250;

/** The API form of a ticket, the executions as `form` gives them. */
export const reportOf = (
  ticket: Ticket,
  form: (execution: ExecutionRecord) => Execution,
): AutoRunReport => ({
  executions: ticket.started.map((run) => form(run.execution)),
  pending: [...ticket.undecided],
  skipped: [...ticket.skipped],
});

function newTicket(from: ExecutionRecord): Ticket {
  let settle = (): void => undefined;
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { from, undecided: new Set(), started: [], skipped: [], done, settle };
}

/** Settles a ticket once every dependent is decided and every run it started ended. */
function settleWhenDecided(ticket: Ticket): void {
  if (ticket.undecided.size > 0) return;
  void Promise.all(ticket.started.map((run) => run.done)).then(ticket.settle);
}

const settingOn = (state: State): boolean =>
  state.context.settings()["execution.autoRunDependents"];

/** cells.autoRun, when what runs or waits changed. */
function show(state: State): void {
  const order = autoRunOrder(state.context.cells.graph(), new Set(state.pending.keys()));
  const shape = { running: state.running?.run.execution.cell ?? null, pending: order };
  const key = JSON.stringify(shape);
  if (key === state.shown) return;
  state.shown = key;
  state.context.emit("cells.autoRun", shape);
}

function forgetIfDone(state: State): void {
  if (state.pending.size > 0 || state.running) return;
  state.held.clear();
  state.seen.clear();
}

function skip(cell: CellId, entry: Pending, reason: AutoRunSkip, by?: CellId): void {
  for (const ticket of entry.tickets) {
    ticket.undecided.delete(cell);
    ticket.skipped.push({ cell, reason, ...(by === undefined ? {} : { by }) });
    settleWhenDecided(ticket);
  }
}

/** Whether `id` holds its dependents back: left alone, failed, or planned and not run well since. */
const holds = (state: State, id: CellId): boolean =>
  state.held.has(id) ||
  (state.seen.has(id) && !state.pending.has(id) && state.context.cells.get(id)?.status !== "ok");

/** Why a dependent due now is left alone, if it is. */
function reasonFor(state: State, cell: CellId, entry: Pending): Omit<Skip, "cell"> | undefined {
  const { cells } = state.context;
  const record = cells.get(cell);
  if (!record) return { reason: "deleted" };
  if (record.last !== entry.last || cells.stale()[cell] !== true) return { reason: "ran" };
  if (record.meta.manual === true) return { reason: "manual" };
  const node = cells.graph().cells.find((c) => c.id === cell);
  const by = node?.dependsOn.find((id) => holds(state, id));
  if (by !== undefined) return { reason: "upstream", by };
  if (record.status === "idle") return { reason: "notRun" };
  if (record.type === "client" && !state.realmAttached()) return { reason: "noPage" };
  return undefined;
}

function start(state: State, cell: CellId, entry: Pending): void {
  const { context } = state;
  const from = entry.tickets[0]?.from;
  const execution = createExecution(context, cell, context.cells.require(cell).analysis.defines, {
    requestedBy: from?.requestedBy,
    autoRun: from === undefined ? undefined : { cell: from.cell, execution: from.id },
  });
  const run = queuedRun(execution);
  state.running = { run, edited: false };
  for (const ticket of entry.tickets) {
    ticket.undecided.delete(cell);
    ticket.started.push(run);
    settleWhenDecided(ticket);
  }
  state.queue.push(run);
}

function stop(state: State): void {
  clearTimeout(state.poll);
  state.poll = undefined;
  for (const [cell, entry] of state.pending) skip(cell, entry, "stopped");
  state.pending.clear();
  show(state);
  forgetIfDone(state);
}

/** Every dependent left waits on another: the graph gained a cycle since. */
function skipCycle(state: State): void {
  for (const [id, entry] of state.pending) {
    skip(id, entry, "cycle");
    state.held.add(id);
  }
  state.pending.clear();
}

/** Decides the dependents due in order until one starts or none is left. */
function advance(state: State): void {
  for (;;) {
    const cell = nextAutoRun(state.context.cells.graph(), new Set(state.pending.keys()));
    if (cell === undefined) {
      skipCycle(state);
      return;
    }
    const entry = state.pending.get(cell);
    state.pending.delete(cell);
    if (!entry) continue;
    const left = reasonFor(state, cell, entry);
    if (left === undefined) {
      start(state, cell, entry);
      return;
    }
    skip(cell, entry, left.reason, left.by);
    if (left.reason !== "ran") state.held.add(cell);
  }
}

/** No cascade step starts while the kernel is paused in the debugger: looks again a little later. */
function later(state: State): void {
  clearTimeout(state.poll);
  state.poll = setTimeout(() => {
    state.poll = undefined;
    if (state.queue.running() === undefined) idle(state);
  }, pollMs);
}

function idle(state: State): void {
  if (state.pending.size === 0 && state.running === undefined && state.shown === idleState) return;
  if (state.pending.size > 0 && !settingOn(state)) {
    stop(state);
    return;
  }
  if (state.pending.size > 0 && state.context.kernel.pauses.paused()) {
    later(state);
    return;
  }
  if (state.pending.size > 0) advance(state);
  show(state);
  forgetIfDone(state);
}

/** Why a dependent is left alone as soon as it is planned, if it is. */
function plannedReason(record: CellRecord, cyclic: ReadonlySet<CellId>): AutoRunSkip | undefined {
  if (cyclic.has(record.id)) return "cycle";
  if (record.meta.manual === true) return "manual";
  if (record.status === "idle") return "notRun";
  return record.status === "queued" || record.status === "running" ? "ran" : undefined;
}

/** A cell.run's run ended well: its stale dependents, the ones it cannot run decided at once. */
function plan(state: State, run: QueuedRun): void {
  const { cells } = state.context;
  const root = run.execution.cell;
  const graph = cells.graph();
  const stale = cells.stale();
  const dependents = dependentsOf(graph, root).filter((id) => id !== root && stale[id] === true);
  if (dependents.length === 0) return;
  const cyclic = cyclicCells(graph, [root, ...dependents]);
  const ticket = newTicket(run.execution);
  state.tickets.set(run, ticket);
  state.seen.add(root);
  for (const id of dependents) {
    state.seen.add(id);
    const record = cells.require(id);
    const reason = plannedReason(record, cyclic);
    if (reason !== undefined) {
      ticket.skipped.push({ cell: id, reason });
      if (reason !== "ran") state.held.add(id);
      continue;
    }
    state.held.delete(id);
    ticket.undecided.add(id);
    const entry = state.pending.get(id);
    if (entry) entry.tickets.push(ticket);
    else state.pending.set(id, { tickets: [ticket], last: record.last });
  }
  settleWhenDecided(ticket);
  show(state);
}

function ended(state: State, run: QueuedRun): void {
  const { cell, status } = run.execution;
  if (state.running?.run === run) {
    if (status === "ok" && !state.running.edited) state.held.delete(cell);
    else state.held.add(cell);
    state.running = undefined;
    show(state);
  } else if (status === "ok") state.held.delete(cell);
  if (run.trigger === true && status === "ok" && settingOn(state)) plan(state, run);
}

function edited(state: State, cell: CellId): void {
  if (state.running?.run.execution.cell === cell) state.running.edited = true;
  const entry = state.pending.get(cell);
  if (!entry) return;
  state.pending.delete(cell);
  skip(cell, entry, "edited");
  state.held.add(cell);
  show(state);
}

export function createAutoRun(
  context: SessionContext,
  queue: RunQueue,
  realmAttached: () => boolean,
): AutoRun {
  const state: State = {
    context,
    queue,
    realmAttached,
    pending: new Map(),
    tickets: new WeakMap(),
    held: new Set(),
    seen: new Set(),
    running: undefined,
    shown: idleState,
    poll: undefined,
  };
  return {
    ended: (run) => {
      ended(state, run);
    },
    idle: () => {
      idle(state);
    },
    edited: (cell) => {
      edited(state, cell);
    },
    stop: () => {
      stop(state);
    },
    ticket: (run) => state.tickets.get(run),
  };
}
