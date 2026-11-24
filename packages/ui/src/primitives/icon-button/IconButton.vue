<!-- IconButton: an icon-only button whose label is its aria-label and its tooltip, with the shortcut beside it; 28 px in toolbars, 36 px in the rail (1.75rem, 2.25rem), or smaller where a row is (a cell header's 20 px). No padding of its own: the browser's 6 px each side squeezed a 13 px icon to 6 px wide in a 20 px button. -->
<script setup lang="ts">
import type { HTMLAttributes } from "vue";

import { cn } from "../cn";
import Kbd from "../kbd/Kbd.vue";
import Tooltip from "../tooltip/Tooltip.vue";
import TooltipContent from "../tooltip/TooltipContent.vue";
import TooltipTrigger from "../tooltip/TooltipTrigger.vue";

const props = withDefaults(
  defineProps<{
    /** What the button does: its aria-label and the tooltip's text. */
    label: string;
    /** The shortcut shown in the tooltip, in words (`Alt Shift Enter`, keyboard/keymap.ts keyWords). */
    keys?: string;
    size?: "toolbar" | "rail";
    /** A toggle's state, as aria-pressed (the rail's open panel). */
    pressed?: boolean;
    disabled?: boolean;
    side?: "top" | "bottom" | "left" | "right";
    class?: HTMLAttributes["class"];
  }>(),
  { size: "toolbar", side: "bottom" },
);
defineEmits<{ click: [event: MouseEvent] }>();
// the root is the tooltip, which renders no element: data attributes and handlers belong on the button
defineOptions({ inheritAttrs: false });
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <button
        type="button"
        v-bind="$attrs"
        data-slot="icon-button"
        :aria-label="label"
        :aria-pressed="pressed"
        :disabled="disabled"
        :class="
          cn(
            'ui:inline-flex ui:shrink-0 ui:cursor-pointer ui:items-center ui:justify-center ui:rounded-control ui:border ui:border-transparent ui:bg-transparent ui:p-0 ui:text-muted ui:hover:bg-well ui:hover:text-fg ui:focus-visible:border-accent ui:active:bg-grip ui:disabled:pointer-events-none ui:disabled:opacity-45 ui:aria-pressed:bg-side ui:aria-pressed:text-fg ui:motion-safe:transition-colors',
            props.size === 'rail' ? 'ui:block-9 ui:inline-9' : 'ui:block-7 ui:inline-7',
            props.class,
          )
        "
        @click="$emit('click', $event)"
      >
        <slot />
      </button>
    </TooltipTrigger>
    <TooltipContent :side="side">
      {{ label }}
      <Kbd v-if="keys">{{ keys }}</Kbd>
    </TooltipContent>
  </Tooltip>
</template>
