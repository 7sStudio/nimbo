// A cell's name and the short description beside it, as the cell header's Name column and the Explorer's outline say
// them. The name is the title the user gave the cell (meta.title), else what the cell is for, read from what the
// notebook already knows of it (the route it serves, what it exports or defines, a markdown cell's heading), so a
// column of names reads as a table of contents; with cells.titleFromFirstLine on, its first line before those.
import type { Cell, CellId, NameOptions, Route } from "@jsnb/core";
import { cellName } from "@jsnb/core";
import { computed } from "vue";
import type { ComputedRef } from "vue";

import type { GraphEntry } from "../store/mirror.js";
import { useNotebookStore } from "../store/notebook.js";
import { useSettingsStore } from "../store/settings.js";

type Named = Pick<Cell, "id" | "type" | "source"> & { readonly meta?: Cell["meta"] };

/** The cell's name (core's cellName): its own title, a markdown cell's heading, its first line when `options` says
 * so, the routes it serves while the kernel listens, what it exports or defines, the routes and names its text
 * declares; "" when none names it, "empty" for a cell with no text. */
export const nameOf = (
  cell: Named,
  entry: GraphEntry | undefined,
  routes: readonly Route[],
  options: NameOptions = {},
): string =>
  cellName(
    cell,
    entry,
    routes
      .filter((route) => route.cell === cell.id)
      .map((route) => `${route.method} ${route.path}`),
    options,
  );

/** The name options the settings give: cells.titleFromFirstLine. */
export const nameOptionsOf = (settings: {
  readonly valueOf: (key: "cells.titleFromFirstLine") => unknown;
}): NameOptions => ({ firstLine: settings.valueOf("cells.titleFromFirstLine") === true });

/** What `cell` calls across the bridge: the first name it uses that a server cell exports, with that cell's number. */
function calls(
  entry: GraphEntry | undefined,
  exporters: ReadonlyMap<string, number>,
): string | null {
  const name = entry?.uses.find((each) => exporters.has(each));
  return name === undefined ? null : `calls ${name} from cell ${String(exporters.get(name) ?? 0)}`;
}

/** The short description after the name: "HTTP route", "exported to client cells", "calls createIntent from cell 3";
 * "" when there is nothing to add. `exporters` is each name a server cell exports with its cell's number. */
export function aboutOf(
  cell: Named,
  entry: GraphEntry | undefined,
  context: {
    readonly routes: readonly Route[];
    readonly exporters: ReadonlyMap<string, number>;
  },
): string {
  if (cell.type === "markdown") return "";
  if (context.routes.some((route) => route.cell === cell.id)) return "HTTP route";
  if (cell.type === "server")
    return entry !== undefined && entry.exports.length > 0 ? "exported to client cells" : "";
  return calls(entry, context.exporters) ?? "";
}

/** The cells' names by id, for the views that list them. */
export function namesOf(
  cells: readonly Named[],
  graph: ReadonlyMap<CellId, GraphEntry>,
  routes: readonly Route[],
  options: NameOptions = {},
): ReadonlyMap<CellId, string> {
  return new Map(cells.map((cell) => [cell.id, nameOf(cell, graph.get(cell.id), routes, options)]));
}

/** The open notebook's cell names by id, following the settings. */
export function useCellNames(): ComputedRef<ReadonlyMap<CellId, string>> {
  const store = useNotebookStore();
  const settings = useSettingsStore();
  return computed(() =>
    namesOf(store.cellsInOrder, store.mirror.graph, store.mirror.routes, nameOptionsOf(settings)),
  );
}
