<!-- TypeIcon: a cell type's icon: server two stacked boxes, client a monitor, markdown text lines; decorative, the label beside or around it names the type. -->
<script setup lang="ts">
import type { CellType } from "@jsnb/core";
import { Monitor, Server, TextAlignStart } from "@lucide/vue";

defineProps<{ type: CellType }>();
</script>

<template>
  <Server v-if="type === 'server'" aria-hidden="true" />
  <Monitor v-else-if="type === 'client'" aria-hidden="true" />
  <TextAlignStart v-else aria-hidden="true" />
</template>
