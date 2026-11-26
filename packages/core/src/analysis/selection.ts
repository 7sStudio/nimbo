// resolveSelection: the cells a Selection names, in notebook order.
import type { CellId } from "../model/ids.js";
import type { Selection } from "../model/selection.js";
import type { Graph } from "./graph.js";
import { dependentsOf } from "./graph.js";
import type { StaleMap } from "./stale.js";

export type SelectionContext = {
  readonly order: readonly CellId[];
  readonly graph: Graph;
  readonly stale: StaleMap;
};

/** Resolves a selection against the notebook order, the graph and the stale flags. */
export function resolveSelection(context: SelectionContext, selection: Selection): CellId[] {
  const { order, graph, stale } = context;
  if (selection === "all") return [...order];
  if ("cells" in selection) return order.filter((id) => selection.cells.includes(id));
  if ("above" in selection) {
    const index = order.indexOf(selection.above);
    return index < 0 ? [] : order.slice(0, index);
  }
  if ("withDependents" in selection) {
    const dependents = dependentsOf(graph, selection.withDependents);
    return order.filter((id) => id === selection.withDependents || dependents.includes(id));
  }
  return order.filter((id) => stale[id] === true);
}
