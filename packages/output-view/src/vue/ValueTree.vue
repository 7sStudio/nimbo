<!-- The tree view: rows virtualized with TanStack Virtual under role="tree", the keyboard of
useTreeKeys, find's matches and "n hidden" rows, copy value and copy path. -->
<script setup lang="ts">
import type { Path } from "@jsnb/core";
import { computed, ref, shallowRef, toRef, useId } from "vue";

import { formatPath } from "../model/path.js";
import type { SearchMatch } from "../model/search.js";
import { thousands } from "../model/preview.js";
import type { Focus, NodeRow } from "../model/tree.js";
import { valueText } from "./clipboard.js";
import { placeOf, useViewer } from "./context.js";
import { closing, rowAttrs } from "./rowView.js";
import TreeRow from "./TreeRow.vue";
import { useTree } from "./useTree.js";
import { useTreeKeys } from "./useTreeKeys.js";
import { useVirtualRows } from "./useVirtualRows.js";
import TextButton from "./TextButton.vue";
import { viewScroller } from "./classes/scroller.js";

const props = withDefaults(
  defineProps<{
    readonly json: unknown;
    readonly label: string;
    readonly expandDepth?: number | undefined;
    readonly focus?: Focus | undefined;
    readonly matches?: ReadonlyMap<string, readonly SearchMatch[]> | undefined;
    readonly maxHeight?: number | undefined;
  }>(),
  { expandDepth: 2 },
);
const emit = defineEmits<{ "show-all": [] }>();
const viewer = useViewer();
const tree = useTree({
  json: toRef(props, "json"),
  expandDepth: toRef(props, "expandDepth"),
  focus: toRef(props, "focus"),
});
const rows = tree.rows;
const scroller = ref<HTMLElement | null>(null);
// 0.125rem of room above the first row and below the last: a row's 1.5rem actions overhang its 1.25rem (chrome.css)
const virtual = useVirtualRows({
  count: computed(() => rows.value.length),
  scroller,
  maxHeight: toRef(props, "maxHeight"),
  room: 0.125,
});
const visible = computed(() =>
  virtual.items.value.flatMap(({ index, start }) => {
    const row = rows.value[index];
    return row ? [{ index, start, row }] : [];
  }),
);
const uid = useId();
const hovered = ref<string>();
const unfolded = shallowRef<ReadonlySet<string>>(new Set());
// In full screen the node shown sits in the output: refs resolve against its root, and paths start at its path.
const place = computed(() => placeOf(viewer, props.json));
const copyValue = (row: NodeRow) => viewer.copy("value", valueText(row.value, place.value.root));
const copyPath = (row: NodeRow) =>
  viewer.copy("path", formatPath([...place.value.base, ...row.path]));
const keys = useTreeKeys(
  { rows, value: () => props.json },
  {
    toggle: tree.toggle,
    copyValue: (row) => {
      void copyValue(row);
    },
    copyPath: (row) => {
      void copyPath(row);
    },
    showAll: () => {
      emit("show-all");
    },
    scrollTo: (index) => {
      virtual.scrollTo(index);
    },
  },
);

function activate(index: number, row: NodeRow): void {
  keys.active.value = index;
  if (viewer.drills && row.hasChildren) viewer.openFullscreen(props.json, row.path);
}
/** Opens the way to a path and scrolls its row into view (find's ↩, a breadcrumb). */
function reveal(path: Path): void {
  tree.reveal(path);
  const index = rows.value.findIndex(
    (row) => row.role === "node" && formatPath(row.path) === formatPath(path),
  );
  if (index < 0) return;
  keys.active.value = index;
  virtual.scrollTo(index, "center");
}
defineExpose({ expandAll: tree.expandAll, collapseAll: tree.collapseAll, reveal });
/**
 * A row, 20 px high, placed by --row-y and indented by --depth. Rows keep --bg, the only background the syntax colors
 * reach 4.5:1 on (palette.ts), so the active row, a hovered one and a selected one are marked by a ring and a bar; the
 * active row's ring in the focused tree wins over a hovered one's, through a compound variant that outweighs the
 * hover ring's selector (no !important).
 */
const rowClass =
  "ov:absolute ov:inset-bs-0 ov:inset-s-0 ov:flex ov:block-5 ov:min-inline-full ov:translate-y-(--row-y) ov:items-center ov:gap-1 ov:rounded-small ov:ps-[calc(var(--depth)*1.125rem+0.25rem)] ov:pe-1.5 ov:whitespace-pre ov:data-selected:shadow-[inset_2px_0_0_var(--accent)] ov:group-focus-visible/tree:aria-selected:outline ov:group-focus-visible/tree:aria-selected:-outline-offset-1 ov:group-focus-visible/tree:aria-selected:outline-accent ov:group-focus-visible/tree:aria-selected:[&[role=treeitem]]:hover:outline-accent ov:[&[role=treeitem]]:hover:outline ov:[&[role=treeitem]]:hover:-outline-offset-1 ov:[&[role=treeitem]]:hover:outline-border-2";
</script>

<template>
  <div
    ref="scroller"
    data-part="tree"
    :class="viewScroller"
    class="ov:group/tree ov:focus-visible:rounded-box"
    role="tree"
    tabindex="0"
    :aria-label="label"
    :aria-activedescendant="rows.length > 0 ? `${uid}-${keys.active.value}` : undefined"
    :data-capped="maxHeight === undefined ? undefined : ''"
    :style="maxHeight === undefined ? undefined : { '--max-height': `${maxHeight}px` }"
    @keydown="keys.onKeydown"
    @mouseleave="hovered = undefined"
  >
    <div
      data-part="tree-body"
      class="ov:relative ov:block-(--tree-size) ov:min-inline-full"
      :style="{ '--tree-size': `${virtual.totalSize.value}px` }"
    >
      <div
        v-for="{ index, start, row } in visible"
        :key="row.id"
        :class="rowClass"
        v-bind="
          rowAttrs(row, { id: `${uid}-${index}`, start, active: keys.active.value === index })
        "
        @mouseenter="hovered = row.id"
        @click="row.role === 'node' && activate(index, row)"
      >
        <TreeRow
          v-if="row.role === 'node'"
          :row="row"
          :root="json"
          :matches="matches?.get(row.id)"
          :show-actions="hovered === row.id || keys.active.value === index"
          :unfolded="unfolded.has(row.id)"
          @toggle="(deep) => tree.toggle(row, deep)"
          @unfold="unfolded = new Set([...unfolded, row.id])"
          @copy-value="copyValue(row)"
          @copy-path="copyPath(row)"
        />
        <TextButton v-else-if="row.role === 'hidden'" part="hint-action" @click="emit('show-all')">
          Show {{ thousands(row.count) }} hidden
        </TextButton>
        <span v-else data-token="punc" class="ov:text-punc">{{ closing(row.kind) }}</span>
      </div>
    </div>
  </div>
</template>
