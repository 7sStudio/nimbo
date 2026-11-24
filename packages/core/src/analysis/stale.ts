// Pure staleness transitions over the graph (00-overview §4.2, 05-bridge §8); every function returns a new map.
import type { CellId } from "../model/ids.js";
import type { Graph } from "./graph.js";
import { dependentsOf } from "./graph.js";

export type StaleMap = Readonly<Record<CellId, boolean>>;

const mark = (stale: StaleMap, ids: readonly CellId[], value: boolean): StaleMap => ({
  ...stale,
  ...Object.fromEntries(ids.map((id) => [id, value])),
});

/** An edit leaves the cell as it was and marks its transitive dependents stale. */
export function afterEdit(graph: Graph, stale: StaleMap, cell: CellId): StaleMap {
  return mark(stale, dependentsOf(graph, cell), true);
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
