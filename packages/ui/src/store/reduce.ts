// The reducer: applies one event of 03-api §6 to the mirror, and folds in what the store fetched (a full
// execution, the graph, the routes). Pure: no Vue, no IO; tested against recorded event logs (fixtures/*.jsonl).
import type {
  Cell,
  CellId,
  DebugState,
  Diagnostic,
  EventEnvelope,
  EventOf,
  Execution,
  NotebookState,
} from "@jsnb/core";

import type { GraphEntry, Mirror } from "./mirror.js";
import { mapCell, reindexed } from "./mirror.js";
import { reduceRun } from "./reduceRun.js";

type Notebook = NotebookState;

const withNotebook = (mirror: Mirror, next: (notebook: Notebook) => Notebook): Mirror =>
  mirror.notebook === null ? mirror : { ...mirror, notebook: next(mirror.notebook) };

/** The debugger's state before the daemon said anything of it: off, no breakpoint. */
export const noDebug: DebugState = { state: "off", paused: null, breakpoints: [] };

const withDebug = (mirror: Mirror, next: (debug: DebugState) => DebugState): Mirror =>
  withNotebook(mirror, (notebook) => ({ ...notebook, debug: next(notebook.debug ?? noDebug) }));

/** An edit: the cells change and autosave has something to write. */
const edited = (mirror: Mirror, cells: (cells: readonly Cell[]) => readonly Cell[]): Mirror => {
  const next = withNotebook(mirror, (notebook) => ({
    ...notebook,
    cells: cells(notebook.cells),
    dirty: true,
  }));
  return mirror.saveState === "saved" ? { ...next, saveState: "writing" } : next;
};

const added = (cells: readonly Cell[], cell: Cell): readonly Cell[] => {
  const rest = cells.filter((each) => each.id !== cell.id);
  return reindexed([...rest.slice(0, cell.index), cell, ...rest.slice(cell.index)]);
};

const moved = (cells: readonly Cell[], order: readonly CellId[]): readonly Cell[] => {
  const byId = new Map(cells.map((cell) => [cell.id, cell]));
  return reindexed(order.flatMap((id) => byId.get(id) ?? []));
};

const without = <V>(map: ReadonlyMap<CellId, V>, id: CellId): ReadonlyMap<CellId, V> =>
  new Map([...map].filter(([key]) => key !== id));

/** A cells.autoRun change applied to the cascade the mirror holds. */
function withAutoRun(mirror: Mirror, change: EventOf<"cells.autoRun">["data"]): Mirror {
  const gone = new Set(change.removed);
  const pending = [...mirror.autoRun.pending.filter((id) => !gone.has(id)), ...change.added];
  return { ...mirror, autoRun: { running: change.running, pending } };
}

function reduceCell(mirror: Mirror, event: EventEnvelope): Mirror {
  switch (event.type) {
    case "cell.added":
      return edited(mirror, (cells) => added(cells, event.data.cell));
    case "cell.updated": {
      const { cell } = event.data;
      const next = edited(mirror, (cells) => mapCell(cells, cell.id, () => cell));
      // cleared outputs (notebook.clearOutputs): the run the page holds goes with them
      return cell.lastExecution === null && next.executions.has(cell.id)
        ? { ...next, executions: without(next.executions, cell.id) }
        : next;
    }
    case "cell.moved":
      return edited(mirror, (cells) => moved(cells, event.data.order));
    case "cell.deleted": {
      const { cell } = event.data;
      const next = edited(mirror, (cells) => reindexed(cells.filter((each) => each.id !== cell)));
      return {
        ...next,
        executions: without(next.executions, cell),
        graph: without(next.graph, cell),
        diagnostics: without(next.diagnostics, cell),
      };
    }
    case "cell.diagnostics":
      return withDiagnostics(mirror, [event.data]);
    case "cells.autoRun":
      return withAutoRun(mirror, event.data);
    case "cells.stale": {
      const stale = new Set(event.data.cells);
      return withNotebook(mirror, (notebook) => ({
        ...notebook,
        cells: notebook.cells.map((cell) =>
          cell.stale === stale.has(cell.id) ? cell : { ...cell, stale: stale.has(cell.id) },
        ),
      }));
    }
    default:
      return reduceRun(mirror, event);
  }
}

/** The debugger's events: where the kernel paused, its resume, the breakpoints. */
function reduceDebug(mirror: Mirror, event: EventEnvelope): Mirror {
  switch (event.type) {
    case "debug.paused":
      return withDebug(mirror, (debug) => ({ ...debug, state: "paused", paused: event.data }));
    case "debug.resumed":
      return withDebug(mirror, (debug) => ({ ...debug, state: event.data.state, paused: null }));
    case "debug.breakpoints":
      return withDebug(mirror, (debug) => ({ ...debug, breakpoints: event.data.breakpoints }));
    default:
      return reduceCell(mirror, event);
  }
}

function reduceNotebook(mirror: Mirror, event: EventEnvelope): Mirror {
  switch (event.type) {
    case "notebook.saved": {
      const { savedAt } = event.data;
      const next = withNotebook(mirror, (notebook) => ({ ...notebook, savedAt, dirty: false }));
      return { ...next, saveState: "saved", saveError: null };
    }
    case "notebook.saveFailed":
      return { ...mirror, saveState: "failed", saveError: event.data.error };
    case "notebook.conflict":
      return { ...mirror, saveState: "conflict" };
    case "notebook.closed":
      return { ...mirror, closed: true };
    case "notebook.opened":
      return { ...mirror, closed: false };
    case "routes.changed":
      return { ...mirror, routes: event.data.routes };
    case "kernel.status":
      return withNotebook(mirror, (notebook) => ({ ...notebook, kernel: event.data }));
    case "realm.status":
      return withNotebook(mirror, (notebook) => ({ ...notebook, realm: event.data }));
    default:
      return reduceDebug(mirror, event);
  }
}

/** The mirror after `event`; an event at or below the mirror's seq, or of another notebook, changes nothing. */
export function reduce(mirror: Mirror, event: EventEnvelope): Mirror {
  const path = mirror.notebook?.path;
  if (event.seq <= mirror.seq || path === undefined || event.notebook !== path) return mirror;
  return { ...reduceNotebook(mirror, event), seq: event.seq };
}

/** Takes the service's lists for these cells (cell.diagnostics, or notebook.diagnostics's answer). */
export function withDiagnostics(
  mirror: Mirror,
  lists: readonly { readonly cell: CellId; readonly diagnostics: readonly Diagnostic[] }[],
): Mirror {
  const next = new Map(mirror.diagnostics);
  for (const { cell, diagnostics } of lists) next.set(cell, diagnostics);
  return { ...mirror, diagnostics: next };
}

/** Folds in a full execution fetched with cell.outputs, unless the mirror already follows a newer run of the cell. */
export function withExecution(mirror: Mirror, execution: Execution): Mirror {
  const known = mirror.executions.get(execution.cell);
  if (known !== undefined && known.id !== execution.id && known.startedAt > execution.startedAt) {
    return mirror;
  }
  return { ...mirror, executions: new Map(mirror.executions).set(execution.cell, execution) };
}

/** Takes a fetched cell's last-run summary (cell.get) when it is the run the mirror follows, or the mirror follows none. */
export function withSummary(mirror: Mirror, fetched: Cell): Mirror {
  const summary = fetched.lastExecution;
  const known = mirror.executions.get(fetched.id);
  if (summary === null || (known !== undefined && known.id !== summary.id)) return mirror;
  return withNotebook(mirror, (notebook) => ({
    ...notebook,
    cells: mapCell(notebook.cells, fetched.id, (cell) => ({ ...cell, lastExecution: summary })),
  }));
}

/** Replaces the graph with a notebook.graph answer. */
export function withGraph(
  mirror: Mirror,
  entries: readonly (GraphEntry & { readonly id: CellId })[],
): Mirror {
  return { ...mirror, graph: new Map(entries.map(({ id, ...entry }) => [id, entry])) };
}
