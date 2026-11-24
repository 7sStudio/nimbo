<!-- StuckActions: what a cell header says after its name while it is stuck to the top of the page over its expanded result: the lines of the result in view, then Fold result (O) and Next cell (J), quiet white buttons with their keys; where the name column is narrow (the 14 inch screen with both panels open) the keys leave the buttons for their tooltips, so the lines in view keep their words. -->
<script setup lang="ts">
import { computed } from "vue";

import { keysShown } from "../keyboard/keymap";
import Kbd from "../primitives/kbd/Kbd.vue";

const props = defineProps<{
  /** The result's lines in view, "lines 9 to 24 of 24". */
  lines: string;
  mac: boolean;
}>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();
/** A button's key, kept while the name column (the container CellHead declares) has room for it. */
const key = "ui:ms-1 ui:@max-[26rem]/name:hidden";
const foldKeys = computed(() => keysShown("ui.cell.toggleOutputs", props.mac));
const nextKeys = computed(() => keysShown("ui.select.next", props.mac));
const button =
  "ui:inline-flex ui:shrink-0 ui:cursor-pointer ui:items-center ui:gap-1 ui:rounded-control ui:border ui:border-transparent ui:bg-sheet ui:px-2 ui:font-sans ui:text-tiny ui:font-medium ui:text-fg ui:block-5.5 ui:hover:bg-well ui:focus-visible:border-accent";
</script>

<template>
  <span
    data-part="about"
    data-testid="stuck-lines"
    class="ui:flex-[1_3_0%] ui:ellipsis ui:text-[0.71875rem] ui:text-fg-2 ui:min-inline-0"
    >{{ props.lines }}</span
  >
  <span class="ui:flex ui:shrink-0 ui:items-center ui:gap-1.5 ui:self-center">
    <button
      type="button"
      :class="button"
      :title="foldKeys ? `Fold result, ${foldKeys}` : 'Fold result'"
      @click="emit('command', 'ui.cell.toggleOutputs')"
    >
      Fold result<Kbd v-if="foldKeys" :class="key">{{ foldKeys }}</Kbd>
    </button>
    <button
      type="button"
      :class="button"
      :title="nextKeys ? `Next cell, ${nextKeys}` : 'Next cell'"
      @click="emit('command', 'ui.select.next')"
    >
      Next cell<Kbd v-if="nextKeys" :class="key">{{ nextKeys }}</Kbd>
    </button>
  </span>
</template>
