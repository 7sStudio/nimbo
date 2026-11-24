<!-- DialogHeader: the dialog header block; shadcn-vue copy on our tokens. -->
<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

const props = defineProps<{
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <div
    data-slot="dialog-header"
    :class="cn('ui:flex ui:flex-col ui:gap-1.5 ui:text-start', props.class)"
  >
    <slot />
  </div>
</template>
