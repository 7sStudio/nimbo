<!-- AddCellRow: adding a cell, as three centred buttons, an icon and one word each: Server, Client, Markdown, each with a tooltip naming its key (Shift S, Shift C, Shift M add one below the selected cell). Under the last cell they are always there; between two cells they show while the gap is hovered or holds the focus, laid over it so nothing moves. -->
<script setup lang="ts">
import type { CellType } from "@jsnb/core";

import { isMac } from "../keyboard/modes";
import { keysShown } from "../keyboard/keymap";
import Kbd from "../primitives/kbd/Kbd.vue";
import Tooltip from "../primitives/tooltip/Tooltip.vue";
import TooltipContent from "../primitives/tooltip/TooltipContent.vue";
import TooltipTrigger from "../primitives/tooltip/TooltipTrigger.vue";
import { typeTone } from "./tones";
import TypeIcon from "./TypeIcon.vue";
import { typeName } from "./types";

const props = defineProps<{
  /** "gap": between two cells, adding after the one above; "last": the row after the last cell. */
  place: "gap" | "last";
  off: boolean;
  /** Between two folded cells: two pixels, so a folded notebook reads as a list (its buttons still show on hover). */
  tight?: boolean;
}>();
const emit = defineEmits<{ add: [type: CellType] }>();
const types: readonly CellType[] = ["server", "client", "markdown"];
const mac = isMac(navigator.userAgent);
/** The type's own key, the user's included (keyboard/keymap.ts); none when they removed it. */
const keysOf = (type: CellType) => keysShown("ui.cell.addBelow", mac, { type });
</script>

<template>
  <div
    :data-part="props.place === 'gap' ? 'add-gap' : 'add-row'"
    :class="
      props.place === 'gap'
        ? [
            'ui:group/gap ui:relative ui:z-(--z-toolbar)',
            props.tight ? 'ui:block-0.5' : 'ui:block-(--cell-gap)',
          ]
        : 'ui:flex ui:justify-center ui:pbs-4 ui:pbe-4.5'
    "
  >
    <div
      role="group"
      :aria-label="props.place === 'gap' ? 'Add a cell here' : 'Add a cell'"
      :class="[
        'ui:flex ui:items-center ui:justify-center ui:gap-1.5',
        props.place === 'gap'
          ? 'ui:pointer-events-none ui:absolute ui:inset-x-0 ui:inset-bs-1/2 ui:-translate-y-1/2 ui:opacity-0 ui:group-hover/gap:pointer-events-auto ui:group-hover/gap:opacity-100 ui:group-has-[:focus-visible]/gap:pointer-events-auto ui:group-has-[:focus-visible]/gap:opacity-100 ui:motion-safe:transition-opacity'
          : '',
      ]"
    >
      <Tooltip v-for="each in types" :key="each">
        <TooltipTrigger as-child>
          <button
            type="button"
            :disabled="props.off"
            :aria-label="
              props.place === 'gap' ? `Add a ${typeName[each].toLowerCase()} cell here` : undefined
            "
            :class="[
              'ui:inline-flex ui:cursor-pointer ui:items-center ui:gap-1.5 ui:rounded-control ui:border ui:border-transparent ui:px-2.75 ui:font-medium ui:text-fg ui:hover:bg-sheet ui:focus-visible:border-accent ui:disabled:pointer-events-none ui:disabled:opacity-45',
              props.place === 'gap'
                ? 'ui:bg-well ui:shadow-pop ui:block-6'
                : 'ui:bg-side ui:block-7',
            ]"
            @click="emit('add', each)"
          >
            <TypeIcon :type="each" :class="['ui:block-3.5 ui:inline-3.5', typeTone[each]]" />
            {{ typeName[each] }}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Add {{ typeName[each] }} Cell
          <Kbd v-if="keysOf(each)">{{ keysOf(each) }}</Kbd>
        </TooltipContent>
      </Tooltip>
    </div>
  </div>
</template>
