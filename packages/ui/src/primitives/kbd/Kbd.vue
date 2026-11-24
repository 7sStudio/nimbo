<!-- Kbd: one key cap, quieter inside a tooltip's dark bubble; shadcn-vue copy on our tokens. -->
<script setup lang="ts">
import type { HTMLAttributes } from "vue";

import { cn } from "../cn";

const props = defineProps<{
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <kbd
    data-slot="kbd"
    :class="
      cn(
        'ui:ms-1.5 ui:inline-flex ui:items-center ui:font-sans ui:text-kbd ui:font-normal ui:text-muted ui:select-none',
        'ui:in-data-[slot=tooltip-content]:text-pop-muted',
        props.class,
      )
    "
  >
    <slot />
  </kbd>
</template>
