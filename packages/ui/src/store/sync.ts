// Keeping the mirror current: hydrate through the client's notebook subscription (events.subscribe, then
// notebook.get, then the events above its seq; again after a reconnect, a gap or the notebook opened again), apply each event, and fetch what
// events do not carry: a finished run's outputs and summary, the graph after an edit, the routes. A fetch that finds the
// notebook no longer open lost a race with its close (an agent's close or `nimbo stop` while a cell ran): the close's own
// event, or follow.ts, says so, so that answer is dropped quietly rather than shown.
import type { Cell, CellId, EventEnvelope } from "@jsnb/core";
import { isJsnbError, notebookDiagnostics, notebookGraph } from "@jsnb/core";
import type { SocketClient, Subscription } from "@jsnb/client";
import type { ShallowRef } from "vue";

import type { Attempt } from "./attempt.js";
import type { Mirror } from "./mirror.js";
import { hydrated, isTerminal } from "./mirror.js";
import { reduce, withDiagnostics, withExecution, withGraph, withSummary } from "./reduce.js";

type Context = {
  readonly mirror: ShallowRef<Mirror>;
  readonly client: () => SocketClient;
  readonly notebook: () => string;
  readonly attempt: Attempt;
  readonly report: (error: unknown) => void;
  /** The notebook opened again after a close: its session is new, so the mirror is hydrated afresh. */
  readonly reopened: () => void;
  /** editor.diagnostics: on, each hydrate asks for the service's lists, which also warms the notebook. */
  readonly diagnostics?: () => boolean;
  /** Something the daemon wants the user to know of (js-debug exited under the kernel). */
  readonly notice?: (text: string) => void;
};

/** The daemon's answer for a notebook that is not open (closed, or never opened). */
export const notOpen = (error: unknown): boolean =>
  isJsnbError(error) && error.name === "NotebookNotFound";

/** A fetch whose NotebookNotFound reads as nothing to fold: the notebook closed while it was on its way. */
const unlessClosed =
  <T>(fetch: () => Promise<T>) =>
  async (): Promise<T | undefined> => {
    try {
      return await fetch();
    } catch (error) {
      if (notOpen(error)) return undefined;
      throw error;
    }
  };

const graphEvents = new Set<EventEnvelope["type"]>([
  "cell.added",
  "cell.updated",
  "cell.deleted",
  "cells.stale",
]);

export function mirrorSync(context: Context) {
  const { mirror, client, notebook, attempt, report, reopened } = context;

  // the fetches that complete what events carry: a finished run's outputs and summary, the graph, the routes

  /** Fetches, then folds the answer into the mirror as it is by then. */
  const fold = async <T>(fetch: () => Promise<T>, into: (m: Mirror, value: T) => Mirror) => {
    const value = await attempt(unlessClosed(fetch));
    if (value !== undefined) mirror.value = into(mirror.value, value);
  };
  const ref = (cell: CellId) => ({ notebook: notebook(), cell });
  const refreshRun = (cell: CellId) =>
    Promise.all([
      fold(
        () => client().cell.outputs(ref(cell)),
        (m, { execution }) => (execution === null ? m : withExecution(m, execution)),
      ),
      fold(
        () => client().cell.get(ref(cell)),
        (m, got) => withSummary(m, got.cell),
      ),
    ]);
  const refreshGraph = () =>
    fold(
      () => client().call(notebookGraph, { notebook: notebook() }),
      (m, { cells }) => withGraph(m, cells),
    );
  const refreshRoutes = () =>
    fold(
      () => client().kernel.routes({ notebook: notebook() }),
      (m, { routes: next }) => ({ ...m, routes: next }),
    );
  const refreshAll = (cells: readonly Cell[]) =>
    Promise.all([
      refreshGraph(),
      refreshRoutes(),
      ...cells.filter((cell) => cell.lastExecution !== null).map((cell) => refreshRun(cell.id)),
    ]);
  /** notebook.diagnostics; a failure (the service is off or down) leaves the editors without lists, quietly. */
  const refreshDiagnostics = async (): Promise<void> => {
    try {
      const { cells } = await client().call(notebookDiagnostics, { notebook: notebook() });
      mirror.value = withDiagnostics(mirror.value, cells);
    } catch {
      // the page works without them: underlines are a help, not a state
    }
  };

  function apply(event: EventEnvelope): void {
    mirror.value = reduce(mirror.value, event);
    if (event.type === "debug.resumed" && event.data.notice !== undefined)
      context.notice?.(event.data.notice);
    if (event.type === "cell.status" && isTerminal(event.data.status))
      void refreshRun(event.data.cell);
    if (graphEvents.has(event.type)) void refreshGraph();
    if (event.type === "notebook.opened") reopened();
  }

  const subscribe = (): Promise<Subscription> =>
    client().subscribeNotebook({
      notebook: notebook(),
      onState: (state, seq) => {
        mirror.value = hydrated(mirror.value, state, seq);
        void refreshAll(state.cells);
        if (context.diagnostics?.() === true) void refreshDiagnostics();
      },
      onEvent: apply,
      onError: report,
    });

  return {
    apply,
    subscribe,
    refreshRoutes,
    /** editor.diagnostics turned on: the lists again; off: none kept. */
    refreshDiagnostics,
    dropDiagnostics: () => {
      mirror.value = { ...mirror.value, diagnostics: new Map() };
    },
  };
}
