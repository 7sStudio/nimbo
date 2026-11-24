<!-- StatusProblems: the status bar's errors and warnings, as VS Code's ("⊗ 2 ⚠ 0"); together they make the Problems tab's count. A click opens the Problems tab, or hides the panel while it shows Problems. The words a screen reader hears are in the button's text, so its name holds what it shows. -->
<script setup lang="ts">
import { CircleX, TriangleAlert } from "@lucide/vue";
import { computed } from "vue";

import { keysShown } from "../keyboard/keymap";
import { isMac } from "../keyboard/modes";
import Kbd from "../primitives/kbd/Kbd.vue";
import Tooltip from "../primitives/tooltip/Tooltip.vue";
import TooltipContent from "../primitives/tooltip/TooltipContent.vue";
import TooltipTrigger from "../primitives/tooltip/TooltipTrigger.vue";
import { plural } from "./models";

const props = defineProps<{
  errors: number;
  warnings: number;
  /** The bottom panel shows Problems now: a click hides it. */
  shown: boolean;
}>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();
// the root is the tooltip, which renders no element: the status bar's class belongs on the button
defineOptions({ inheritAttrs: false });

const keys = keysShown("ui.panel.open", isMac(navigator.userAgent), { which: "problems" });
const summary = computed(() =>
  props.errors + props.warnings === 0
    ? "No problems"
    : `${plural(props.errors, "error")}, ${plural(props.warnings, "warning")}`,
);
const icon = "ui:block-3 ui:inline-3";
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <button
        type="button"
        v-bind="$attrs"
        data-testid="status-problems"
        :aria-pressed="props.shown"
        @click="
          props.shown
            ? emit('command', 'ui.bottom.toggle')
            : emit('command', 'ui.panel.open', { which: 'problems' })
        "
      >
        <CircleX :class="[icon, props.errors > 0 ? 'ui:text-err' : '']" aria-hidden="true" /><span
          data-testid="status-errors"
          >{{ props.errors }}</span
        ><span class="ui:visually-hidden">&nbsp;errors,</span>
        <TriangleAlert
          :class="['ui:ms-0.5', icon, props.warnings > 0 ? 'ui:text-warn-text' : '']"
          aria-hidden="true"
        /><span data-testid="status-warnings">{{ props.warnings }}</span
        ><span class="ui:visually-hidden">&nbsp;warnings</span>
      </button>
    </TooltipTrigger>
    <TooltipContent side="top">
      {{ summary }}
      <Kbd v-if="keys">{{ keys }}</Kbd>
    </TooltipContent>
  </Tooltip>
</template>
