<!-- Segmented: a one-of-n control (the boards' .seg: Server / Client, User / Workspace, Tree / Grid) on Reka's ToggleGroup; one item stays chosen. -->
<script setup lang="ts">
import type { HTMLAttributes } from "vue";

import { ToggleGroupRoot } from "reka-ui";

import { cn } from "../cn";

const props = defineProps<{ label: string; class?: HTMLAttributes["class"] }>();
const model = defineModel<string>({ required: true });

/** Reka lets a single group be emptied by clicking its item again; a segmented control always has one. */
function choose(value: unknown): void {
  if (typeof value === "string" && value !== "") model.value = value;
}
</script>

<template>
  <ToggleGroupRoot
    type="single"
    data-slot="segmented"
    :aria-label="label"
    :model-value="model"
    :class="
      cn(
        'ui:inline-flex ui:items-center ui:gap-0.5 ui:rounded-control ui:bg-well ui:p-0.5',
        props.class,
      )
    "
    @update:model-value="choose"
  >
    <slot />
  </ToggleGroupRoot>
</template>
