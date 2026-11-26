<!-- The grid view: records or a matrix under role="grid", sortable and filterable headers, virtual
rows (TanStack Table + Virtual), find's marks, row click → the row as a tree, copy row, selection for export. -->
<script setup lang="ts">
import { computed, ref, toRef, useId } from "vue";

import { columnChip } from "../model/chips.js";
import type { Chip } from "../model/chips.js";
import type { Column, ColumnLayout, Grid, GridRow } from "../model/records.js";
import { arrangeGrid, cellOf, hideColumn, moveColumn, showAllColumns } from "../model/records.js";
import type { SearchMatch } from "../model/search.js";
import type { Focus } from "../model/tree.js";
import { valueText } from "./clipboard.js";
import { placeOf, useViewer } from "./context.js";
import GridHeader from "./GridHeader.vue";
import GridStatus from "./GridStatus.vue";
import GridCell from "./GridCell.vue";
import { cellId, columnWidths, isNumeric, shownChars } from "./gridView.js";
import IconButton from "./IconButton.vue";
import { useGrid } from "./useGrid.js";
import { useGridKeys } from "./useGridKeys.js";
import { useVirtualRows } from "./useVirtualRows.js";
import { viewScroller } from "./classes/scroller.js";
import { gridHead, gridIndex, gridRow } from "./classes/grid.js";

const props = defineProps<{
  readonly grid: Grid;
  /** The value the rows come from: a row opens as a tree at its index in it, and refs resolve against it. */
  readonly root: unknown;
  readonly label: string;
  readonly matches?: ReadonlyMap<string, readonly SearchMatch[]> | undefined;
  readonly focus?: Focus | undefined;
  readonly maxHeight?: number | undefined;
  /** Given when Filter mode is available: a column filter becomes this chip. */
  readonly onChip?: ((chip: Chip) => void) | undefined;
  /** The columns as the user arranged them; absent, the grid's own order, every column shown. */
  readonly layout?: ColumnLayout | undefined;
  /** Hide and move are offered (the host keeps the layout). */
  readonly arrange?: boolean | undefined;
}>();
const selection = defineModel<readonly number[]>("selection", { default: () => [] });
const emit = defineEmits<{ layout: [layout: ColumnLayout] }>();
// Every view below reads the arranged grid: hidden columns are gone, the rest in the user's order.
const arranged = computed(() => arrangeGrid(props.grid, props.layout));
const hiddenCount = computed(() => props.grid.columns.length - arranged.value.columns.length);
const hide = (key: string) => {
  emit("layout", hideColumn(props.grid, props.layout, key));
};
const move = (key: string, to: number) => {
  emit("layout", moveColumn(props.grid, props.layout, key, to));
};
const showAll = () => {
  emit("layout", showAllColumns(props.layout));
};
const viewer = useViewer();
const leaf = computed(() => {
  const timeZone = viewer.hints.value.timeZone;
  return timeZone === undefined ? {} : { timeZone };
});
const table = useGrid({ grid: arranged, focus: toRef(props, "focus"), leaf });
const rows = table.rows;
const rowOf = (index: number): GridRow => props.grid.rows[index] ?? { index, node: undefined };
const cell = (index: number, column: Column) => cellOf(rowOf(index), column);
const widths = computed(() =>
  columnWidths(arranged.value, cell, (at, path) => shownChars(at, viewer.hints.value, path)),
);
// The first column holds the row's number and its action (10ch: up to six digits and the copy button), frozen at the
// start edge, so a grid wider than its output shows the action whole and covers no cell (N4).
const template = computed(() => `10ch ${widths.value.map((w) => `${String(w)}ch`).join(" ")}`);
const scroller = ref<HTMLElement | null>(null);
const virtual = useVirtualRows({
  count: computed(() => rows.value.length),
  scroller,
  maxHeight: toRef(props, "maxHeight"),
  rowHeight: 1.5,
});
const visible = computed(() =>
  virtual.items.value.flatMap(({ index, start }) => {
    const row = rows.value[index];
    return row ? [{ at: index, start, row }] : [];
  }),
);
// In full screen the node shown sits in the output: refs resolve against its root, hint paths start at its path.
const place = computed(() => placeOf(viewer, props.root));
const copy = (row: GridRow) => viewer.copy("row", valueText(row.node, place.value.root));
const keys = useGridKeys(rows, selection, {
  open: (row) => {
    viewer.openFullscreen(props.root, [row.index]);
  },
  copy: (row) => {
    void copy(row);
  },
  scrollTo: (index) => {
    virtual.scrollTo(index);
  },
});
const headers = table.headers;
const uid = useId();
const hovered = ref<number>();
const rangesOf = (index: number, column: Column) =>
  props.matches?.get(cellId(index, column))?.find((match) => match.in === "value")?.ranges;
const addChip = (column: Column, text: string) =>
  props.onChip?.(columnChip(column.key, text, isNumeric(arranged.value, column, cell)));
</script>

<template>
  <div
    ref="scroller"
    role="grid"
    data-part="grid"
    :class="viewScroller"
    tabindex="0"
    :aria-label="label"
    :aria-rowcount="rows.length + 1"
    :aria-activedescendant="rows.length > 0 ? `${uid}-${keys.active.value}` : undefined"
    :data-capped="maxHeight === undefined ? undefined : ''"
    :style="{ '--columns': template, '--max-height': maxHeight && `${maxHeight}px` }"
    @keydown="keys.onKeydown"
    @mouseleave="hovered = undefined"
  >
    <div role="row" data-part="grid-head" :class="gridHead" aria-rowindex="1">
      <div role="columnheader" data-part="grid-index" :class="gridIndex">#</div>
      <GridHeader
        v-for="({ column, tableColumn }, at) in headers"
        :key="column.key"
        :column="tableColumn"
        :label="column.label"
        :chips="onChip !== undefined"
        :place="at"
        :shown="headers.length"
        :hidden="hiddenCount"
        :arrange="arrange === true"
        @chip="(text) => addChip(column, text)"
        @hide="hide(String(column.key))"
        @move="(to) => move(String(column.key), to)"
        @show-all="showAll"
        @drop="(from) => move(from, at)"
      />
    </div>
    <div
      data-part="grid-body"
      class="ov:relative ov:block-(--grid-size)"
      :style="{ '--grid-size': `${virtual.totalSize.value}px` }"
    >
      <div
        v-for="{ at, start, row } in visible"
        :id="`${uid}-${at}`"
        :key="row.index"
        role="row"
        data-part="grid-row"
        :class="gridRow"
        :aria-rowindex="at + 2"
        :aria-selected="selection.includes(row.index)"
        :data-active="keys.active.value === at ? '' : undefined"
        :style="{ '--row-y': `${start}px` }"
        @mouseenter="hovered = at"
        @click="keys.onClick($event, at, row)"
      >
        <div role="gridcell" data-part="grid-index" :class="gridIndex">
          {{ row.index }}
          <!-- 24 px square from the row's top edge to the next row's ('s 28 px is the toolbars'): a 28 px one
          stuck out of the last row, so a grid that fits scrolled and showed Expand -->
          <IconButton
            v-if="hovered === at || keys.active.value === at"
            label="Copy row"
            icon="copy"
            shortcut="⌘C"
            size="row"
            class="ov:self-start"
            @click.stop="copy(row)"
          />
        </div>
        <GridCell
          v-for="column in arranged.columns"
          :key="column.key"
          :cell="cellOf(row, column)"
          :path="[...place.base, row.index, column.key]"
          :leaf="leaf"
          :ranges="rangesOf(row.index, column)"
        />
      </div>
    </div>
  </div>
  <GridStatus
    :shown="rows.length"
    :total="grid.rows.length"
    :root="root"
    :hidden="hiddenCount"
    @show-all="showAll"
  />
</template>
