<!-- CellMenu: the cell's menu, from the toolbar's "more" button, ⌘. or a right-click on the gutter: run, run with dependents, run all above, change type, values, collapse, pin to the inspector, move up, move down, copy cell id, delete; each item a command on the cell, which the menu selected as it opened. -->
<script setup lang="ts">
import { computed } from "vue";

import type { Overlay } from "../store/overlay";
import { isFolded } from "../store/fold";
import { useNotebookStore } from "../store/notebook";
import { useUiStore } from "../store/ui";
import AnchoredMenu from "./AnchoredMenu.vue";
import { cellMenuItems } from "./menus";

const props = defineProps<{ overlay: Extract<Overlay, { kind: "cellMenu" }> }>();
const notebook = useNotebookStore();
const ui = useUiStore();
const items = computed(() => {
  const cell = notebook.byId.get(props.overlay.cell);
  return cell === undefined
    ? []
    : cellMenuItems(cell.type, {
        values: cell.meta.showBindings === true,
        collapsed: isFolded(cell, ui.foldAll, ui.opened),
        pinned: ui.pinned === cell.id,
      });
});
</script>

<template>
  <AnchoredMenu :overlay="props.overlay" :items="items" label="Cell actions" />
</template>
