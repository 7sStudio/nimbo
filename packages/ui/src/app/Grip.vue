<!-- Grip: the gap between a workbench region and the notebook, which is that region's resizer. A window splitter (WAI-ARIA separator) that a pointer drags and the keyboard moves by 1 rem, Home and End to the bounds, Enter or a double click back to the default. Its mark, a short bar in the middle of the gap that never touches a cell, shows only on hover, focus or drag, as VS Code's sashes; its tooltip says what it does. -->
<script setup lang="ts">
import { useResizeObserver } from "@vueuse/core";
import { computed, ref } from "vue";

import type { Edge } from "../composables/useResize";
import { sizeOf, useResize } from "../composables/useResize";
import Tooltip from "../primitives/tooltip/Tooltip.vue";
import TooltipContent from "../primitives/tooltip/TooltipContent.vue";
import TooltipTrigger from "../primitives/tooltip/TooltipTrigger.vue";

const props = defineProps<{
  /** The id of the region this grip resizes. */
  controls: string;
  /** What it resizes, in its label: "Resize the side panel". */
  name: string;
  edge: Edge;
  /** The stored size in rem, or null for the default. */
  size: number | null;
  bounds: { readonly min: number; readonly max: number };
}>();
const emit = defineEmits<{ resize: [rem: number | null] }>();

const region = () => document.getElementById(props.controls);
const { onPointerDown, onKeyDown, onDoubleClick } = useResize(
  region,
  { edge: props.edge, bounds: props.bounds },
  (rem) => {
    emit("resize", rem);
  },
);
/** The size the region shows, in rem to a quarter: the stored one, or the default's measure (a separator a keyboard
 * moves needs its value). */
const measured = ref(props.bounds.min);
useResizeObserver(region, () => {
  const element = region();
  if (element !== null) measured.value = sizeOf(element, props.edge);
});
const now = computed(() => Math.round((props.size ?? measured.value) * 4) / 4);
const across = computed(() => props.edge === "bottom");
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <div
        role="separator"
        tabindex="0"
        :aria-orientation="across ? 'horizontal' : 'vertical'"
        :aria-label="`Resize the ${props.name}`"
        :aria-controls="props.controls"
        :aria-valuemin="props.bounds.min"
        :aria-valuemax="props.bounds.max"
        :aria-valuenow="now"
        :aria-valuetext="`${String(now)} rem${props.size === null ? ', the default' : ''}`"
        :data-testid="`grip-${props.controls}`"
        :class="[
          'ui:group ui:flex ui:shrink-0 ui:touch-none ui:items-center ui:justify-center ui:rounded-control ui:focus-visible:shadow-none',
          across
            ? 'ui:cursor-row-resize ui:block-(--gap) ui:inline-full'
            : 'ui:cursor-col-resize ui:block-full ui:inline-(--gap)',
        ]"
        @pointerdown="onPointerDown"
        @keydown="onKeyDown"
        @dblclick="onDoubleClick"
      >
        <span
          aria-hidden="true"
          :class="[
            'ui:rounded-control ui:bg-transparent ui:group-hover:bg-muted ui:group-focus-visible:bg-fg ui:group-focus-visible:shadow-[0_0_0_2px_var(--guide-on)] ui:group-active:bg-fg ui:motion-safe:transition-colors',
            across ? 'ui:block-[0.1875rem] ui:inline-9' : 'ui:block-9 ui:inline-[0.1875rem]',
          ]"
        />
      </div>
    </TooltipTrigger>
    <TooltipContent :side="across ? 'top' : props.edge === 'left' ? 'right' : 'left'">
      <span class="ui:font-medium">Drag to resize</span>
      <span class="ui:block ui:text-pop-muted">Double click resets</span>
    </TooltipContent>
  </Tooltip>
</template>
