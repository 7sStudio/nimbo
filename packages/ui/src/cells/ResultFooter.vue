<!-- ResultFooter: the row under a long result. Capped, it says which lines are in view ("Lines 1 to 7 of 42, scrolls in place") with Pin to inspector (P), Expand and Fold; expanded, that every line shows and that the cell header stays in view while the page scrolls through it, with Pin to inspector and the way back to the cap. Fold hides the result (O), as the cell menu's does. -->
<script setup lang="ts">
import { Pin } from "@lucide/vue";
import { computed } from "vue";

import { keysShown } from "../keyboard/keymap";
import Kbd from "../primitives/kbd/Kbd.vue";
import { wordButton } from "../panel/rows";
import type { Lines } from "./resultLines";

const props = defineProps<{
  lines: Lines;
  /** The result shows all its lines (meta.outputHeight "fit"). */
  expanded: boolean;
  /** The cap is the page's seven lines, not a height the outputs.maxHeightPx setting chose. */
  sevenLines: boolean;
  mac: boolean;
}>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();
const pinKeys = computed(() => keysShown("ui.cell.pin", props.mac));
</script>

<template>
  <div
    data-part="result-footer"
    class="ui:flex ui:items-center ui:gap-4 ui:text-tiny ui:text-muted ui:min-block-5.5"
  >
    <span data-testid="result-lines" class="ui:ellipsis ui:min-inline-0">
      <template v-if="props.expanded"
        >All {{ props.lines.total }} lines shown. The header stays in view while the result
        scrolls.</template
      >
      <template v-else
        >Lines {{ props.lines.first }} to {{ props.lines.last }} of {{ props.lines.total }}, scrolls
        in place</template
      >
    </span>
    <span class="ui:ms-auto ui:flex ui:shrink-0 ui:items-center ui:gap-2">
      <button
        type="button"
        data-testid="pin-result"
        :class="[wordButton, 'ui:bg-sheet ui:px-2 ui:hover:bg-well']"
        @click="emit('command', 'ui.cell.pin')"
      >
        <Pin class="ui:block-3 ui:inline-3" aria-hidden="true" />
        Pin to inspector<Kbd v-if="pinKeys" class="ui:ms-1">{{ pinKeys }}</Kbd>
      </button>
      <button
        type="button"
        data-testid="result-height"
        :class="wordButton"
        @click="
          emit('command', 'cell.update', {
            meta: { outputHeight: props.expanded ? 'capped' : 'fit' },
          })
        "
      >
        {{ props.expanded ? (props.sevenLines ? "Cap at 7 lines" : "Cap the height") : "Expand" }}
      </button>
      <button
        v-if="!props.expanded"
        type="button"
        :class="wordButton"
        title="Hide the result under one row, O"
        @click="emit('command', 'ui.cell.toggleOutputs')"
      >
        Fold
      </button>
    </span>
  </div>
</template>
