// The grid's table (TanStack Table): one column per record key sorted by compareCells, a local column filter on the
// cells' text, and the rows find leaves when "Only matches" folds the rest away.
import type { Column as TableColumn } from "@tanstack/vue-table";
import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/vue-table";
import type { Ref } from "vue";
import { computed } from "vue";

import type { LeafOptions } from "../model/leaf.js";
import type { Cell, Grid, GridRow } from "../model/records.js";
import { cellOf } from "../model/records.js";
import { compareCells } from "../model/sort.js";
import type { Focus } from "../model/tree.js";
import { cellTokens, rowId } from "./gridView.js";

const features = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
});
const helper = createColumnHelper<typeof features, GridRow>();

export type GridColumn = TableColumn<typeof features, GridRow>;

export type GridSource = {
  readonly grid: Readonly<Ref<Grid>>;
  readonly focus: Readonly<Ref<Focus | undefined>>;
  readonly leaf: Readonly<Ref<LeafOptions>>;
};

const cellText = (cell: Cell, options: LeafOptions): string =>
  cellTokens(cell, options)
    .map((token) => token.text)
    .join("")
    .toLowerCase();

function columnsOf(grid: Grid, leaf: Readonly<Ref<LeafOptions>>) {
  return helper.columns(
    grid.columns.map((column) =>
      helper.accessor((row) => cellOf(row, column), {
        id: String(column.key),
        header: column.label,
        sortDescFirst: false,
        sortFn: (a, b, id) => compareCells(a.getValue<Cell>(id), b.getValue<Cell>(id)),
        filterFn: (row, id, text: unknown) =>
          cellText(row.getValue<Cell>(id), leaf.value).includes(String(text).toLowerCase()),
      }),
    ),
  );
}

export function useGrid(source: GridSource) {
  // TanStack unwraps computed options and follows them: a new grid (an SQL result, back to rows) is read again.
  const columns = computed(() => columnsOf(source.grid.value, source.leaf));
  const data = computed(() => source.grid.value.rows);
  const table = useTable<typeof features, GridRow>({
    features,
    columns,
    data,
    getRowId: (row) => String(row.index),
  });
  /** The rows in view order; with "Only matches", those holding a match. */
  const rows = computed(() => {
    const ordered = table.getRowModel().rows.map((row) => row.original);
    const focus = source.focus.value;
    if (focus?.only !== true) return ordered;
    return ordered.filter(
      (row) => focus.ids.has(rowId(row.index)) || focus.within.has(rowId(row.index)),
    );
  });
  /** Each column of the grid with its TanStack column, narrowed here so the header's template needs no assertion. */
  const headers = computed(() =>
    source.grid.value.columns.flatMap((column, at) => {
      const tableColumn: GridColumn | undefined = table.getAllLeafColumns()[at];
      return tableColumn ? [{ column, tableColumn }] : [];
    }),
  );
  return {
    rows,
    headers,
    filtered: computed(() => table.getAllLeafColumns().some((column) => column.getIsFiltered())),
  };
}
