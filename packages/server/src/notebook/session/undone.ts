// A deleted cell added back under its id with the same type and source (the page's undo, cell.add { id }) gets back
// its runs, and its stale flag as the graph gives it: stale when it was, or when what it depends on is no longer what
// its last run read (another cell, another source, another run).
import type { CellId, Graph, StaleMap } from "@jsnb/core";

import type { SessionContext } from "./context.js";
import type { CellRecord } from "./records.js";
import { terminalStatuses } from "./records.js";

type Dependency = {
  readonly source: string;
  readonly type: string;
  readonly run: string | undefined;
};

type Kept = Pick<CellRecord, "type" | "source" | "status" | "last" | "previous" | "ran"> & {
  readonly stale: boolean;
  readonly dependencies: ReadonlyMap<CellId, Dependency>;
};

/** As many deleted cells as the page's undo can bring back at most, and more. */
const keptLimit = 200;

const keptOf = new WeakMap<SessionContext, Map<CellId, Kept>>();

const kept = (context: SessionContext): Map<CellId, Kept> => {
  let map = keptOf.get(context);
  if (!map) {
    map = new Map();
    keptOf.set(context, map);
  }
  return map;
};

function dependenciesOf(context: SessionContext, graph: Graph, cell: CellId) {
  const ids = graph.cells.find((each) => each.id === cell)?.dependsOn ?? [];
  return new Map(
    ids.flatMap((id): [CellId, Dependency][] => {
      const record = context.cells.get(id);
      return record
        ? [[id, { source: record.source, type: record.type, run: record.last?.id }]]
        : [];
    }),
  );
}

/** Keeps a cell about to be deleted, with what it depends on in `graph`, the graph before the delete. */
export function keepDeleted(context: SessionContext, graph: Graph, record: CellRecord): void {
  const map = kept(context);
  map.delete(record.id);
  map.set(record.id, {
    ...{ type: record.type, source: record.source, status: record.status },
    ...{ last: record.last, previous: record.previous, ran: record.ran },
    stale: context.cells.stale()[record.id] === true,
    dependencies: dependenciesOf(context, graph, record.id),
  });
  for (const id of map.keys()) {
    if (map.size <= keptLimit) break;
    map.delete(id);
  }
}

const sameDependencies = (a: ReadonlyMap<CellId, Dependency>, b: ReadonlyMap<CellId, Dependency>) =>
  a.size === b.size &&
  [...a].every(([id, was]) => {
    const now = b.get(id);
    return now?.source === was.source && now.type === was.type && now.run === was.run;
  });

/** Gives a cell just added under a deleted cell's id, with its type and source, that cell's runs; answers the stale
 * flags with its own as the graph gives it, or `stale` unchanged when the cell is a new one. */
export function restoreDeleted(
  context: SessionContext,
  record: CellRecord,
  stale: StaleMap,
): StaleMap {
  const map = kept(context);
  const was = map.get(record.id);
  map.delete(record.id);
  if (was?.last === undefined || was.type !== record.type || was.source !== record.source)
    return stale;
  Object.assign(record, {
    last: was.last,
    previous: was.previous,
    ran: was.ran,
    status: terminalStatuses.has(was.status) ? was.status : "idle",
  });
  const now = dependenciesOf(context, context.cells.graph(), record.id);
  return { ...stale, [record.id]: was.stale || !sameDependencies(was.dependencies, now) };
}
