// The dependency graph of a notebook (00-overview §4.2, 05-bridge §5): edges from uses to defines and exports.
import type { CellType } from "../model/cell.js";
import type { CellId } from "../model/ids.js";
import type { CellAnalysis } from "../model/analysis.js";

export type GraphInput = {
  readonly id: CellId;
  readonly type: CellType;
  readonly analysis: CellAnalysis;
};

export type GraphCell = {
  readonly id: CellId;
  readonly type: CellType;
  readonly defines: readonly string[];
  /** The cell's free names that another cell defines or exports (realm globals never appear). */
  readonly uses: readonly string[];
  readonly exports: readonly string[];
  readonly dependsOn: readonly CellId[];
};

export type Graph = { readonly cells: readonly GraphCell[] };

const intersects = (a: readonly string[], b: readonly string[]): boolean =>
  a.some((name) => b.includes(name));

/** The names of `provider` that a cell of `kind` can see: defines in the same realm, a server cell's exports
 * from a client cell (05-bridge §1, §5). A client cell provides nothing to a server cell: nothing crosses that way. */
function provided(provider: GraphInput, kind: CellType): readonly string[] {
  if (provider.type === "markdown") return [];
  if (provider.type === kind) return provider.analysis.defines;
  return provider.type === "server" ? provider.analysis.exports : [];
}

/** Builds the graph in notebook order; markdown cells have no names and no edges. */
export function buildGraph(cells: readonly GraphInput[]): Graph {
  return {
    cells: cells.map((cell) => {
      if (cell.type === "markdown") {
        return { id: cell.id, type: cell.type, defines: [], uses: [], exports: [], dependsOn: [] };
      }
      const others = cells.filter((other) => other.id !== cell.id);
      const visible = others.flatMap((other) => provided(other, cell.type));
      return {
        id: cell.id,
        type: cell.type,
        defines: cell.analysis.defines,
        uses: cell.analysis.uses.filter((name) => visible.includes(name)),
        exports: cell.analysis.exports,
        dependsOn: others
          .filter((other) => intersects(cell.analysis.uses, provided(other, cell.type)))
          .map((other) => other.id),
      };
    }),
  };
}

/** Transitive closure over `next`, in graph order, excluding `start` unless it is reached through a cycle. */
function closure(
  graph: Graph,
  start: CellId,
  next: (cell: GraphCell) => readonly CellId[],
): CellId[] {
  const reached = new Set<CellId>();
  const pending = [start];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined) break;
    const cell = graph.cells.find((c) => c.id === id);
    for (const target of cell ? next(cell) : []) {
      if (reached.has(target)) continue;
      reached.add(target);
      pending.push(target);
    }
  }
  return graph.cells.map((c) => c.id).filter((id) => reached.has(id));
}

/** Every cell that depends on `id`, directly or through other cells, in notebook order. */
export function dependentsOf(graph: Graph, id: CellId): CellId[] {
  return closure(graph, id, (cell) =>
    graph.cells.filter((c) => c.dependsOn.includes(cell.id)).map((c) => c.id),
  );
}

/** Every cell `id` depends on, directly or through other cells, in notebook order. */
export function dependenciesOf(graph: Graph, id: CellId): CellId[] {
  return closure(graph, id, (cell) => cell.dependsOn);
}
