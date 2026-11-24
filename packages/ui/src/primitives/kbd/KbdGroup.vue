<!-- KbdGroup: a row of key caps; shadcn-vue copy on our tokens. -->
<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

const props = defineProps<{
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <kbd data-slot="kbd-group" :class="cn('ui:inline-flex ui:items-center ui:gap-0.5', props.class)">
    <slot />
  </kbd>
</template>
