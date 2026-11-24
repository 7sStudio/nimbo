<!-- RestartMenu: the restart menu, from the top bar's restart icon or the kernel cluster: Restart Kernel (0 0), Restart Kernel and Page, Interrupt (I I), named as the Run menu names them. A restart while a cell runs asks first (ConfirmDialog). -->
<script setup lang="ts">
import type { Overlay } from "../store/overlay";
import AnchoredMenu from "./AnchoredMenu.vue";
import { restartItems } from "./menus";

const props = defineProps<{ overlay: Extract<Overlay, { kind: "restartMenu" }> }>();
</script>

<template>
  <AnchoredMenu :overlay="props.overlay" :items="restartItems" label="Restart" />
</template>
