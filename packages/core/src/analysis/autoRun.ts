// The order of execution.autoRunDependents over the graph: the cells caught in a cycle, which it
// refuses to run through, and the dependency order of the cells it still has to run, ties in notebook order.
import type { CellId } from "../model/ids.js";
import type { Graph, GraphCell } from "./graph.js";

type Tarjan = {
  readonly byId: ReadonlyMap<CellId, GraphCell>;
  readonly index: Map<CellId, number>;
  readonly low: Map<CellId, number>;
  readonly stack: CellId[];
  readonly onStack: Set<CellId>;
  readonly cyclic: Set<CellId>;
};

const lowOf = (state: Tarjan, id: CellId): number => state.low.get(id) ?? 0;

/** Pops the component rooted at `id`; a component of more than one cell is a cycle. */
function popComponent(state: Tarjan, id: CellId): void {
  const component: CellId[] = [];
  for (let top = state.stack.pop(); top !== undefined; top = state.stack.pop()) {
    state.onStack.delete(top);
    component.push(top);
    if (top === id) break;
  }
  if (component.length > 1) for (const member of component) state.cyclic.add(member);
}

function visit(state: Tarjan, id: CellId): void {
  const at = state.index.size;
  state.index.set(id, at);
  state.low.set(id, at);
  state.stack.push(id);
  state.onStack.add(id);
  for (const next of state.byId.get(id)?.dependsOn ?? []) {
    if (!state.byId.has(next)) continue;
    if (!state.index.has(next)) {
      visit(state, next);
      state.low.set(id, Math.min(lowOf(state, id), lowOf(state, next)));
    } else if (state.onStack.has(next)) {
      state.low.set(id, Math.min(lowOf(state, id), state.index.get(next) ?? 0));
    }
  }
  if (lowOf(state, id) === at) popComponent(state, id);
}

/** The cells of `among` on a cycle of the graph restricted to `among` (Tarjan's strongly connected components). */
export function cyclicCells(graph: Graph, among: Iterable<CellId>): Set<CellId> {
  const members = new Set(among);
  const state: Tarjan = {
    byId: new Map(graph.cells.filter((c) => members.has(c.id)).map((c) => [c.id, c])),
    index: new Map(),
    low: new Map(),
    stack: [],
    onStack: new Set(),
    cyclic: new Set(),
  };
  for (const id of state.byId.keys()) if (!state.index.has(id)) visit(state, id);
  return state.cyclic;
}

const waitsOn = (cell: GraphCell, pending: ReadonlySet<CellId>): boolean =>
  cell.dependsOn.some((id) => id !== cell.id && pending.has(id));

/** The first cell of `pending` in notebook order that depends on no other pending cell; undefined when each waits
 * on another (a cycle the graph gained since). */
export function nextAutoRun(graph: Graph, pending: ReadonlySet<CellId>): CellId | undefined {
  return graph.cells.find((cell) => pending.has(cell.id) && !waitsOn(cell, pending))?.id;
}

/** `pending` in the order its cells would run (dependencies first, ties in notebook order); cells caught in a cycle
 * come last, in notebook order. */
export function autoRunOrder(graph: Graph, pending: ReadonlySet<CellId>): CellId[] {
  const left = new Set(pending);
  const order: CellId[] = [];
  let progressed = true;
  while (left.size > 0 && progressed) {
    progressed = false;
    for (const cell of graph.cells) {
      if (!left.has(cell.id) || waitsOn(cell, left)) continue;
      left.delete(cell.id);
      order.push(cell.id);
      progressed = true;
    }
  }
  return [...order, ...graph.cells.map((c) => c.id).filter((id) => left.has(id))];
}
