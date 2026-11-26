// Pure staleness transitions over the graph; every function returns a new map.
import type { CellId } from "../model/ids.js";
import type { Graph, GraphCell } from "./graph.js";
import { dependentsOf } from "./graph.js";

export type StaleMap = Readonly<Record<CellId, boolean>>;

const mark = (stale: StaleMap, ids: readonly CellId[], value: boolean): StaleMap => ({
  ...stale,
  ...Object.fromEntries(ids.map((id) => [id, value])),
});

/** An edit leaves the cell's own flag alone (`withEdited` adds it) and marks its transitive dependents stale. */
export function afterEdit(graph: Graph, stale: StaleMap, cell: CellId): StaleMap {
  return mark(stale, dependentsOf(graph, cell), true);
}

/**
 * The flags as they are shown: the dependency flags the transitions keep, and stale too each cell in `edited`, whose
 * last run in its realm ran other code than it has now (its result is of that code). A cell edited back to the code
 * its last run ran leaves `edited`, so its own part goes; what its edit marked downstream stays.
 */
export function withEdited(stale: StaleMap, edited: readonly CellId[]): StaleMap {
  return edited.length === 0 ? stale : mark(stale, edited, true);
}

/** A delete marks the dependents stale and forgets the cell; `graph` is the graph before the delete. */
export function afterDelete(graph: Graph, stale: StaleMap, cell: CellId): StaleMap {
  const marked = mark(stale, dependentsOf(graph, cell), true);
  return Object.fromEntries(Object.entries(marked).filter(([id]) => id !== cell));
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
