// Pure staleness transitions over the graph; every function returns a new map.
import type { CellId } from "../model/ids.js";
import type { Graph, GraphCell } from "./graph.js";
import { dependentsOf } from "./graph.js";

export type StaleMap = Readonly<Record<CellId, boolean>>;

const mark = (stale: StaleMap, ids: readonly CellId[], value: boolean): StaleMap => ({
  ...stale,
  ...Object.fromEntries(ids.map((id) => [id, value])),
});

/**
 * An edit marks the cell's transitive dependents stale, and the cell itself when `ran` says it has a result of other
 * code than it has now (its last run in its realm ran other code). A cell that never ran is left as it was.
 */
export function afterEdit(graph: Graph, stale: StaleMap, cell: CellId, ran = false): StaleMap {
  return mark(stale, [...dependentsOf(graph, cell), ...(ran ? [cell] : [])], true);
}

/** A delete marks the dependents stale and forgets the cell; `graph` is the graph before the delete. */
export function afterDelete(graph: Graph, stale: StaleMap, cell: CellId): StaleMap {
  const marked = mark(stale, dependentsOf(graph, cell), true);
  return Object.fromEntries(Object.entries(marked).filter(([id]) => id !== cell));
}

/**
 * A run that started in its realm, whatever its end: a cell whose code changed while it ran is stale, its result being
 * of the code it ran; otherwise the flag stays as the run left it (an ok run cleared it, a failed one kept it).
 */
export function afterRunEnded(
  stale: StaleMap,
  cell: CellId,
  editedWhileRunning: boolean,
): StaleMap {
  return editedWhileRunning ? mark(stale, [cell], true) : stale;
}

/** A run clears the cell's own flag and marks its transitive dependents stale. */
export function afterRun(graph: Graph, stale: StaleMap, cell: CellId): StaleMap {
  return mark(mark(stale, dependentsOf(graph, cell), true), [cell], false);
}

/** A kernel restart clears every server cell and marks the client cells that use a server export stale. */
export function afterKernelRestart(graph: Graph, stale: StaleMap): StaleMap {
  const servers = graph.cells.filter((c) => c.type === "server").map((c) => c.id);
  const bridged = graph.cells
    .filter((c) => c.type === "client" && c.dependsOn.some((id) => servers.includes(id)))
    .map((c) => c.id);
  return mark(mark(stale, servers, false), bridged, true);
}

/** The words "edited since its last run" a cell stale for its own edit shows. */
export const editedReason = "edited since its last run";

/**
 * Why a stale cell's result may be out of date: its own code changed since it ran, else the first name it uses that a
 * cell it depends on defines ("count changed in cell 2"); "" when neither says.
 */
export function staleReason(
  cell: Pick<GraphCell, "uses" | "dependsOn"> | undefined,
  upstream: (id: CellId) => Pick<GraphCell, "defines"> | undefined,
  edited: boolean,
  numberOf: (id: CellId) => number,
): string {
  if (edited) return editedReason;
  for (const id of cell?.dependsOn ?? []) {
    const name = upstream(id)?.defines.find((each) => cell?.uses.includes(each));
    if (name !== undefined) return `${name} changed in cell ${String(numberOf(id))}`;
  }
  return "";
}
