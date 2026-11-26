// The cells of an open notebook in order, with the dependency graph and the stale flags over them:
// adds, moves and removals by id, the graph rebuilt from the analyses, staleness through core's rules.
import type { CellId, Graph, GraphInput, StaleMap } from "@jsnb/core";
import { buildGraph, CellNotFound, Conflict, staleReason } from "@jsnb/core";

import type { CellRecord } from "./records.js";
import { ranOther, toCell } from "./records.js";

type Lookup = {
  readonly list: () => readonly CellRecord[];
  readonly order: () => readonly CellId[];
  readonly get: (id: CellId) => CellRecord | undefined;
  /** The cell, or CELL_NOT_FOUND. */
  readonly require: (id: CellId) => CellRecord;
  readonly api: (record: CellRecord) => ReturnType<typeof toCell>;
};

type Ordering = {
  /** Inserts after `after` (null: at the top, undefined: at the end); CONFLICT for an id in use, CELL_NOT_FOUND for `after`. */
  readonly insert: (record: CellRecord, after: CellId | null | undefined) => void;
  readonly move: (id: CellId, after: CellId | null) => void;
  readonly remove: (id: CellId) => void;
  readonly replaceAll: (records: readonly CellRecord[]) => void;
};

type Staleness = {
  readonly graph: () => Graph;
  readonly stale: () => StaleMap;
  /** Sets the flags (of cells that exist); returns whether the set of stale cells changed. */
  readonly setStale: (next: StaleMap) => boolean;
  readonly staleCells: () => CellId[];
};

export type CellStore = Lookup & Ordering & Staleness;

type State = { records: CellRecord[]; stale: StaleMap };

/** Why `record` is stale, from the graph and its last run. */
function reasonOf(state: State, graph: Graph, record: CellRecord): string {
  const byId = new Map(graph.cells.map((cell) => [cell.id, cell]));
  const numberOf = (id: CellId) => state.records.findIndex((each) => each.id === id) + 1;
  return staleReason(byId.get(record.id), (id) => byId.get(id), ranOther(record), numberOf);
}

function lookup(state: State, graph: () => Graph): Lookup {
  const get = (id: CellId) => state.records.find((record) => record.id === id);
  return {
    list: () => state.records,
    order: () => state.records.map((record) => record.id),
    get,
    require: (id) => {
      const found = get(id);
      if (!found) throw new CellNotFound({ cell: id });
      return found;
    },
    api: (record) => {
      const stale = state.stale[record.id] === true;
      const why = stale ? reasonOf(state, graph(), record) : "";
      return toCell(record, state.records.indexOf(record), stale, why);
    },
  };
}

const positionAfter = (
  records: readonly CellRecord[],
  after: CellId | null | undefined,
): number => {
  if (after === undefined) return records.length;
  if (after === null) return 0;
  const index = records.findIndex((record) => record.id === after);
  if (index < 0) throw new CellNotFound({ cell: after });
  return index + 1;
};

function ordering(state: State, cells: Lookup): Ordering {
  const place = (
    record: CellRecord,
    rest: CellRecord[],
    after: CellId | null | undefined,
  ): void => {
    const at = positionAfter(rest, after);
    state.records = [...rest.slice(0, at), record, ...rest.slice(at)];
  };
  return {
    insert: (record, after) => {
      if (cells.get(record.id)) throw new Conflict({ id: record.id });
      place(record, state.records, after);
    },
    move: (id, after) => {
      const record = cells.require(id);
      if (after !== id)
        place(
          record,
          state.records.filter((other) => other.id !== id),
          after,
        );
    },
    remove: (id) => {
      cells.require(id);
      state.records = state.records.filter((record) => record.id !== id);
    },
    replaceAll: (records) => {
      state.records = [...records];
    },
  };
}

/** The graph of the records, built again only when a cell's id, place, type or analysis changed since (an edit
 * gives a cell a new analysis object). */
function graphOf(state: State): () => Graph {
  let inputs: readonly GraphInput[] = [];
  let graph: Graph | undefined;
  const same = (): boolean =>
    state.records.length === inputs.length &&
    state.records.every((record, at) => {
      const was = inputs[at];
      return was?.id === record.id && was.type === record.type && was.analysis === record.analysis;
    });
  return () => {
    if (graph !== undefined && same()) return graph;
    inputs = state.records.map(({ id, type, analysis }) => ({ id, type, analysis }));
    graph = buildGraph(inputs);
    return graph;
  };
}

function staleness(state: State, graph: () => Graph): Staleness {
  const staleCells = () =>
    state.records.filter((record) => state.stale[record.id] === true).map((record) => record.id);
  return {
    graph,
    stale: () => state.stale,
    setStale: (next) => {
      const before = staleCells().join(",");
      const known = new Set(state.records.map((record) => record.id));
      state.stale = Object.fromEntries(
        Object.entries(next).filter(([id, flag]) => known.has(id) && flag),
      );
      return staleCells().join(",") !== before;
    },
    staleCells,
  };
}

/** A store over `initial`, in its order, nothing stale. */
export function createCellStore(initial: readonly CellRecord[]): CellStore {
  const state: State = { records: [...initial], stale: {} };
  const graph = graphOf(state);
  const cells = lookup(state, graph);
  return { ...cells, ...ordering(state, cells), ...staleness(state, graph) };
}
