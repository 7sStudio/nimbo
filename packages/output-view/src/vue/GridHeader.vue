<!-- A grid column's header (gallery card 2): the label sorts on click (asc, desc, off) and the filter popover narrows
the rows (its funnel shows on hover, focus, or while a filter is on), or adds a chip to the query bar when Filter mode is there (11-query §4).
Right-click opens the column menu (sort, hide, move, show all, as a JetBrains data grid's); dragging a header onto
another moves the column there. -->
<script setup lang="ts">
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuTrigger,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
} from "reka-ui";
import { computed, ref } from "vue";

import { useViewer } from "./context.js";
import Icon from "./Icon.vue";
import IconButton from "./IconButton.vue";
import type { GridColumn } from "./useGrid.js";
import { menuItem, menuPanel } from "./classes/menu.js";
import { field } from "./classes/field.js";

const props = defineProps<{
  readonly column: GridColumn;
  readonly label: string;
  /** Filter mode is available: the filter becomes a chip instead of narrowing the grid here. */
  readonly chips: boolean;
  /** The column's place among the shown ones, how many show, and how many are hidden. */
  readonly place: number;
  readonly shown: number;
  readonly hidden: number;
  /** The host can keep a layout (the viewer is not readonly). */
  readonly arrange: boolean;
}>();
const emit = defineEmits<{
  chip: [text: string];
  hide: [];
  move: [to: number];
  "show-all": [];
  drop: [from: string];
}>();
const dragOver = ref(false);
function onDrop(event: DragEvent): void {
  dragOver.value = false;
  const from = event.dataTransfer?.getData("application/x-jsnb-column");
  if (from !== undefined && from !== "") emit("drop", from);
}
const { theme } = useViewer();
const open = ref(false);
const text = ref("");
const sorted = computed(() => props.column.getIsSorted());
const ariaSort = computed(() =>
  sorted.value === "asc" ? "ascending" : sorted.value === "desc" ? "descending" : undefined,
);

function apply(): void {
  if (props.chips) emit("chip", text.value);
  else props.column.setFilterValue(text.value === "" ? undefined : text.value);
  open.value = false;
}
</script>

<template>
  <ContextMenuRoot>
    <ContextMenuTrigger as-child :disabled="!arrange">
      <div
        role="columnheader"
        data-part="grid-header"
        class="ov:group ov:flex ov:min-inline-0 ov:items-center ov:gap-0.5 ov:ps-2 ov:pe-0 ov:data-drop:shadow-[inset_0.125rem_0_0_var(--accent)]"
        :aria-sort="ariaSort"
        :draggable="arrange"
        :data-drop="dragOver ? '' : undefined"
        @dragstart="
          (event) => event.dataTransfer?.setData('application/x-jsnb-column', String(column.id))
        "
        @dragover.prevent="dragOver = arrange"
        @dragleave="dragOver = false"
        @drop.prevent="onDrop"
      >
        <button
          type="button"
          data-part="sort"
          class="ov:inline-flex ov:cursor-pointer ov:items-center ov:gap-1 ov:overflow-clip ov:border-0 ov:bg-transparent ov:p-0 ov:font-inherit ov:text-ellipsis ov:whitespace-nowrap ov:text-inherit"
          @click="column.getToggleSortingHandler()?.($event)"
        >
          {{ label }}<Icon v-if="sorted" :name="sorted === 'asc' ? 'up' : 'down'" />
        </button>
        <PopoverRoot v-model:open="open">
          <PopoverTrigger as-child>
            <IconButton
              :label="`Filter ${label}`"
              icon="filter"
              data-action="column-filter"
              :pressed="column.getIsFiltered()"
              class="ov:opacity-0 ov:group-hover:opacity-100 ov:focus-visible:opacity-100 ov:aria-expanded:opacity-100 ov:aria-pressed:opacity-100"
            />
          </PopoverTrigger>
          <PopoverPortal>
            <PopoverContent
              class="jsnb-ov"
              :class="menuPanel"
              data-part="popover"
              :data-theme="theme"
              side="bottom"
              align="start"
              :side-offset="4"
            >
              <input
                v-model="text"
                type="text"
                data-part="popover-input"
                :class="field"
                class="ov:min-inline-0"
                :aria-label="`Filter ${label}`"
                :placeholder="chips ? 'value' : 'contains…'"
                @keydown.enter.prevent="apply"
              />
            </PopoverContent>
          </PopoverPortal>
        </PopoverRoot>
      </div>
    </ContextMenuTrigger>
    <ContextMenuPortal>
      <ContextMenuContent class="jsnb-ov" :class="menuPanel" data-part="menu" :data-theme="theme">
        <ContextMenuItem
          data-part="menu-item"
          :class="menuItem"
          @select="column.toggleSorting(false)"
          >Sort Ascending</ContextMenuItem
        >
        <ContextMenuItem
          data-part="menu-item"
          :class="menuItem"
          @select="column.toggleSorting(true)"
          >Sort Descending</ContextMenuItem
        >
        <ContextMenuSeparator class="ov:my-1 ov:block-0 ov:border-bs ov:border-border" />
        <ContextMenuItem
          data-part="menu-item"
          :class="menuItem"
          :disabled="shown <= 1"
          @select="emit('hide')"
          >Hide Column</ContextMenuItem
        >
        <ContextMenuItem
          data-part="menu-item"
          :class="menuItem"
          :disabled="place === 0"
          @select="emit('move', place - 1)"
          >Move Left</ContextMenuItem
        >
        <ContextMenuItem
          data-part="menu-item"
          :class="menuItem"
          :disabled="place >= shown - 1"
          @select="emit('move', place + 1)"
          >Move Right</ContextMenuItem
        >
        <template v-if="hidden > 0">
          <ContextMenuSeparator class="ov:my-1 ov:block-0 ov:border-bs ov:border-border" />
          <ContextMenuItem data-part="menu-item" :class="menuItem" @select="emit('show-all')"
            >Show All Columns ({{ hidden }} hidden)</ContextMenuItem
          >
        </template>
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>
