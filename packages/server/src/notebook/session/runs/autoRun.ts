// execution.autoRunDependents: a cell.run that ends well plans its stale dependents, and each time the
// queue has nothing else to run the next of them runs, dependencies first, so whatever anyone asks for meanwhile runs
// before the rest of the cascade. A failure, or a dependent left alone, holds back what depends on it; an edit takes
// the cell out; interrupt, restart and close stop it all. Each cell.run's ticket answers which dependents it started.
import type { AutoRunReport, AutoRunSkip, CellId, Execution, Graph } from "@jsnb/core";
import { autoRunOrder, cyclicCells, dependentsOf, nextAutoRun } from "@jsnb/core";

import type { SessionContext } from "../context.js";
import { restale } from "../edits.js";
import type { CellRecord, ExecutionRecord } from "../records.js";
import { createExecution } from "./executions.js";
import type { QueuedRun, RunQueue } from "./queue.js";
import { queuedRun } from "./queue.js";

type Skip = { readonly cell: CellId; readonly reason: AutoRunSkip; readonly by?: CellId };

/** One cell.run's share of the cascade: its dependents not decided yet, those it started and those it left alone. */
type Ticket = {
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
  /** A cell's code or type changed (`before`, the graph before it): it leaves the cascade, and what depends on it
   * waits. */
  readonly edited: (cell: CellId, before: Graph) => void;
  /** Interrupt, restart, close or the setting turned off: every dependent still waiting stays stale. */
  readonly stop: () => void;
  /** The ticket a cell.run's run got, once it ended well with the setting on. */
  readonly ticket: (run: QueuedRun) => Ticket | undefined;
  /** A cell is about to be deleted. */
  readonly deleting: (cell: CellId) => void;
  /** The kernel ended or the page's realm was reset: the cascade stops, and what ran there no longer counts. */
  readonly realmEnded: (realm: "server" | "client") => void;
  /** NotebookState.autoRun: the dependent running and those waiting, in run order. */
  readonly state: () => { readonly running: CellId | null; readonly pending: readonly CellId[] };
  /** The API form of a ticket, the executions as `form` gives them, what still waits in run order. */
  readonly report: (
    ticket: Ticket,
    form: (execution: ExecutionRecord) => Execution,
  ) => AutoRunReport;
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
  /** Waiting cells that depended on a waiting cell deleted since (the graph no longer shows the edge). */
  readonly orphans: Map<CellId, CellId>;
  running: { readonly run: QueuedRun; edited: boolean } | undefined;
  /** What the page was last told (cells.autoRun): the running cell and the waiting ones. */
  shown: { running: CellId | null; pending: Set<CellId> };
  /** A cells.autoRun is due at the next turn: the changes of one turn go out as one event. */
  flushing: boolean;
  poll: NodeJS.Timeout | undefined;
};

const pollMs = 250;

/** Whether the cell's code as it is now ran in its realm, as its type now: auto-run never runs code unseen. */
const hasRun = (record: CellRecord): boolean =>
  record.ran?.source === record.source && record.ran.type === record.type;

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

/** cells.autoRun with what changed since the page was last told, if anything did. */
function flush(state: State): void {
  state.flushing = false;
  const running = state.running?.run.execution.cell ?? null;
  const { shown, pending } = state;
  const added = [...pending.keys()].filter((id) => !shown.pending.has(id));
  const removed = [...shown.pending].filter((id) => !pending.has(id));
  if (running === shown.running && added.length === 0 && removed.length === 0) return;
  state.shown = { running, pending: new Set(pending.keys()) };
  state.context.emit("cells.autoRun", { running, added, removed });
}

/** Tells the page once this turn's changes are made (a step ends a run and starts the next in one turn). */
function show(state: State): void {
  if (state.flushing) return;
  state.flushing = true;
  setImmediate(() => {
    flush(state);
  });
}

function forgetIfDone(state: State): void {
  if (state.pending.size > 0 || state.running) return;
  state.held.clear();
  state.seen.clear();
  state.orphans.clear();
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
function reasonFor(
  state: State,
  graph: Graph,
  record: CellRecord,
  entry: Pending,
): Omit<Skip, "cell"> | undefined {
  const { cells } = state.context;
  if (record.last !== entry.last || cells.stale()[record.id] !== true) return { reason: "ran" };
  if (record.meta.manual === true) return { reason: "manual" };
  const node = graph.cells.find((c) => c.id === record.id);
  const by = state.orphans.get(record.id) ?? node?.dependsOn.find((id) => holds(state, id));
  if (by !== undefined) return { reason: "upstream", by };
  if (!hasRun(record)) return { reason: "notRun" };
  // a client cell with no page to run in, or a server cell with no kernel: a cascade never starts a kernel, and one
  // that ended took what the dependents need with it
  if (record.type === "client" && !state.realmAttached()) return { reason: "noPage" };
  if (record.type === "server" && state.context.kernel.live() === undefined)
    return { reason: "stopped" };
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

/** Waiting cells deleted since: they leave as `deleted`, and hold back nothing (they are out of the graph). */
function dropDeleted(state: State): void {
  for (const [id, entry] of state.pending) {
    if (state.context.cells.get(id)) continue;
    state.pending.delete(id);
    skip(id, entry, "deleted");
  }
}

/** Decides the dependents due in order until one starts or none is left. */
function advance(state: State): void {
  dropDeleted(state);
  const graph = state.context.cells.graph();
  for (;;) {
    const cell = nextAutoRun(graph, new Set(state.pending.keys()));
    if (cell === undefined) {
      skipCycle(state);
      return;
    }
    const entry = state.pending.get(cell);
    const record = state.context.cells.get(cell);
    state.pending.delete(cell);
    if (!entry || !record) continue;
    const left = reasonFor(state, graph, record, entry);
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

/** Nothing waits or runs: the page hears the cascade ended, if it has not yet. */
function quiet(state: State): void {
  if (state.shown.running !== null || state.shown.pending.size > 0) show(state);
  forgetIfDone(state);
}

function idle(state: State): void {
  if (state.pending.size === 0 && state.running === undefined && !state.flushing) {
    quiet(state);
    return;
  }
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
  if (record.status === "queued" || record.status === "running") return "ran";
  return hasRun(record) ? undefined : "notRun";
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

/** The waiting dependents of `cell` in `graph` (the graph before a change that may cut the edges) wait on it. */
function orphan(state: State, graph: Graph, cell: CellId): void {
  for (const id of dependentsOf(graph, cell))
    if (state.pending.has(id) && !state.orphans.has(id)) state.orphans.set(id, cell);
}

/** A cell leaving the cascade by `reason` while waiting or running: what depends on it waits on it. */
function leaves(state: State, graph: Graph, cell: CellId, reason: "deleted" | "edited"): void {
  const running = state.running?.run.execution.cell === cell;
  const entry = state.pending.get(cell);
  if (!running && !entry) return;
  if (state.running && running) state.running.edited = true;
  if (entry) {
    state.pending.delete(cell);
    skip(cell, entry, reason);
  }
  state.held.add(cell);
  orphan(state, graph, cell);
  show(state);
}

function realmEnded(state: State, realm: "server" | "client"): void {
  for (const record of state.context.cells.list())
    if (record.type === realm) record.ran = undefined;
  if (state.pending.size > 0) stop(state);
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
    orphans: new Map(),
    running: undefined,
    shown: { running: null, pending: new Set() },
    flushing: false,
    poll: undefined,
  };
  return {
    ended: (run) => {
      ended(state, run);
    },
    idle: () => {
      idle(state);
    },
    edited: (cell, before) => {
      leaves(state, before, cell, "edited");
    },
    stop: () => {
      stop(state);
    },
    ticket: (run) => state.tickets.get(run),
    deleting: (cell) => {
      leaves(state, context.cells.graph(), cell, "deleted");
    },
    realmEnded: (realm) => {
      realmEnded(state, realm);
      // the realm's code is gone: a cell stale only for an edit since its run there is not any more
      restale(context, context.cells.stale());
    },
    state: () => ({
      running: state.running?.run.execution.cell ?? null,
      pending: autoRunOrder(context.cells.graph(), new Set(state.pending.keys())),
    }),
    report: (ticket, form) => ({
      executions: ticket.started.map((run) => form(run.execution)),
      pending: autoRunOrder(context.cells.graph(), ticket.undecided),
      skipped: [...ticket.skipped],
    }),
  };
}
