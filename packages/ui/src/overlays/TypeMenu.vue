<!-- TypeMenu: the type chip's menu (the gutter's switchable type icon): Server, Client, Markdown, the cell's own marked current, beside the chip; opened by Y, Server and Client for the marked markdown cells. -->
<script setup lang="ts">
import { computed } from "vue";

import type { Overlay } from "../store/overlay";
import { useNotebookStore } from "../store/notebook";
import AnchoredMenu from "./AnchoredMenu.vue";
import { typeItems } from "./menus";

const props = defineProps<{ overlay: Extract<Overlay, { kind: "typeMenu" }> }>();
const notebook = useNotebookStore();
const items = computed(() => {
  const cell = notebook.byId.get(props.overlay.cell);
  return cell === undefined ? [] : typeItems(cell.type, props.overlay.toCode === true);
});
</script>

<template>
  <AnchoredMenu :overlay="props.overlay" :items="items" label="Cell type" side="right" />
</template>
