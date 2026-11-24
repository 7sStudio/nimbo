<!-- The viewer's icons: 16 px strokes in currentColor, drawn here so the package needs no icon library. -->
<script setup lang="ts">
import type { IconName } from "./icons.js";
import { iconPaths } from "./icons.js";

defineProps<{ readonly name: IconName }>();
</script>

<template>
  <svg
    data-part="icon"
    class="ov:inline-[1.15cap] ov:block-[1.15cap] ov:min-block-3.5 ov:min-inline-3.5 ov:flex-none ov:fill-none ov:stroke-current ov:[stroke-width:2] ov:[stroke-linecap:round] ov:[stroke-linejoin:round]"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <path :d="iconPaths[name]" />
  </svg>
</template>
