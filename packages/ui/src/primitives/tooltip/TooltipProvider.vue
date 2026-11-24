<!-- TooltipProvider: the provider that shares tooltip delays with its subtree; shadcn-vue copy on our tokens; 300 ms delay, none between siblings. -->
<script setup lang="ts">
import type { TooltipProviderProps } from "reka-ui";
import { TooltipProvider } from "reka-ui";

const props = withDefaults(defineProps<TooltipProviderProps>(), {
  delayDuration: 300,
  skipDelayDuration: 300,
});
</script>

<template>
  <TooltipProvider v-bind="props">
    <slot />
  </TooltipProvider>
</template>
