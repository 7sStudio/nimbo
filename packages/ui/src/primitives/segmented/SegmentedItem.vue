<!-- SegmentedItem: one choice of a Segmented control, 22 px tall (1.375rem); the chosen one on the page's background. -->
<script setup lang="ts">
import type { HTMLAttributes } from "vue";

import { ToggleGroupItem } from "reka-ui";

import { cn } from "../cn";

const props = defineProps<{ value: string; class?: HTMLAttributes["class"] }>();
</script>

<template>
  <ToggleGroupItem
    data-slot="segmented-item"
    :value="value"
    :class="
      cn(
        'ui:inline-flex ui:cursor-pointer ui:items-center ui:gap-1.25 ui:rounded-small ui:border ui:border-transparent ui:bg-transparent ui:px-1.75 ui:text-tiny ui:text-fg-2 ui:block-5 ui:hover:text-fg ui:focus-visible:border-accent ui:data-[state=on]:bg-sheet ui:data-[state=on]:font-medium ui:data-[state=on]:text-fg ui:motion-safe:transition-colors',
        props.class,
      )
    "
  >
    <slot />
  </ToggleGroupItem>
</template>
