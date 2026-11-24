<!-- Section: one collapsible group of a side view or of the inspector (Outline, Packages, Variables…), as VS Code's view sections: a header row with a chevron, the title, a count badge and the section's own tools (icon actions shown while the header is hovered or focused); then the content. An empty section starts folded and unfolds the first time something arrives, unless the user folded or unfolded it; that choice is kept in the layout. -->
<script setup lang="ts">
import { ChevronDown, ChevronRight, Info } from "@lucide/vue";
import { ref, watch } from "vue";

import Tooltip from "../primitives/tooltip/Tooltip.vue";
import TooltipContent from "../primitives/tooltip/TooltipContent.vue";
import TooltipTrigger from "../primitives/tooltip/TooltipTrigger.vue";
import { useUiStore } from "../store/ui";

const props = withDefaults(
  defineProps<{
    /** The section's name in ids and data attributes ("variables"). */
    name: string;
    title: string;
    /** How many items it holds, shown as a badge; 0 folds it. */
    count?: number;
    /** It holds nothing: folds it as a count of 0 does, without a badge. */
    empty?: boolean;
    /** What the section is, shown on hover or focus of an info icon after the title: one line per entry. */
    info?: readonly string[];
    /** A word after the title where a count does not say it ("pnpm"). */
    note?: string;
    /** Its tools show only while the header is hovered or focused (icon actions, as VS Code has them). */
    hoverTools?: boolean;
    /** Something of its own is open (an Add form, an install): the section unfolds while it is. */
    forceOpen?: boolean;
  }>(),
  // A boolean prop left out is false; undefined keeps "no empty prop" apart from "not empty".
  { empty: undefined },
);
defineSlots<{ default?: () => unknown; tools?: () => unknown }>();

const ui = useUiStore();
const isEmpty = () => props.empty ?? (props.count === undefined ? undefined : props.count === 0);
const folded = (): boolean | undefined => ui.layout.folds[props.name];
const open = ref(folded() ?? !(isEmpty() ?? false));
const toggle = () => {
  open.value = !open.value;
  ui.setFold(props.name, open.value);
};
// Side effect: a group asked for by name (ui.revealed: a link, the palette, the hidden inspector's icons) unfolds.
watch(
  () => ui.revealed,
  (asked) => {
    if (asked?.section === props.name) open.value = true;
  },
  { immediate: true },
);
// Side effect: an Add form or an install opened from the header's tools unfolds the section, so it shows.
watch(
  () => props.forceOpen,
  (forced) => {
    if (forced) open.value = true;
  },
);
// Side effect: an empty section the user left alone unfolds when its first item arrives, and folds when it empties.
watch(isEmpty, (empty) => {
  if (folded() === undefined && empty !== undefined) open.value = !empty;
});
</script>

<template>
  <section
    :aria-labelledby="`section-${props.name}`"
    :data-section="props.name"
    class="ui:flex ui:flex-col ui:min-inline-0"
  >
    <div
      class="ui:group/head ui:flex ui:items-center ui:gap-1 ui:whitespace-nowrap ui:select-none ui:block-6.5 ui:min-inline-0"
    >
      <button
        type="button"
        :aria-expanded="open"
        :aria-controls="`section-${props.name}-body`"
        :class="[
          'ui:-ms-1 ui:inline-flex ui:cursor-pointer ui:items-center ui:gap-1 ui:rounded-control ui:border ui:border-transparent ui:bg-transparent ui:px-0.5 ui:text-start ui:block-6 ui:min-inline-0 ui:focus-visible:border-accent',
          props.info ? 'ui:shrink' : 'ui:flex-1',
        ]"
        @click="toggle"
      >
        <component
          :is="open ? ChevronDown : ChevronRight"
          class="ui:shrink-0 ui:text-muted ui:block-3.5 ui:inline-3.5"
          aria-hidden="true"
        />
        <h3
          :id="`section-${props.name}`"
          class="ui:tracking-wide ui:m-0 ui:ellipsis ui:text-tiny ui:font-semibold ui:text-fg-2 ui:uppercase"
        >
          {{ props.title }}
        </h3>
        <span
          v-if="props.count !== undefined"
          data-part="count"
          class="ui:ms-1 ui:shrink-0 ui:rounded-[1em] ui:bg-well ui:px-1.5 ui:text-center ui:font-mono ui:text-[0.6875rem] ui:font-medium ui:text-fg-2 ui:min-inline-[1.25rem]"
          >{{ props.count }}</span
        >
        <span v-if="props.note" class="ui:ms-1 ui:ellipsis ui:text-tiny ui:text-muted">{{
          props.note
        }}</span>
      </button>
      <template v-if="props.info">
        <Tooltip :delay-duration="200">
          <TooltipTrigger as-child>
            <button
              type="button"
              data-part="info"
              :aria-label="`About ${props.title}`"
              class="ui:inline-flex ui:shrink-0 ui:cursor-help ui:items-center ui:justify-center ui:rounded-control ui:border ui:border-transparent ui:bg-transparent ui:p-0 ui:text-muted ui:block-5 ui:inline-5 ui:hover:text-fg ui:focus-visible:border-accent"
            >
              <Info class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            align="start"
            class="ui:flex ui:flex-col ui:gap-1 ui:max-inline-[18rem]"
          >
            <p v-for="line in props.info" :key="line" class="ui:leading-snug ui:m-0">
              {{ line }}
            </p>
          </TooltipContent>
        </Tooltip>
        <!-- the rest of the row folds the section too, as the title does -->
        <span class="ui:flex-1 ui:self-stretch" aria-hidden="true" @click="toggle" />
      </template>
      <span
        :class="[
          'ui:flex ui:shrink-0 ui:items-center ui:gap-0.5',
          props.hoverTools
            ? 'ui:opacity-0 ui:group-hover/head:opacity-100 ui:group-has-[:focus-visible]/head:opacity-100'
            : '',
        ]"
        ><slot name="tools"
      /></span>
    </div>
    <div
      v-show="open"
      :id="`section-${props.name}-body`"
      class="ui:flex ui:flex-col ui:pbe-2 ui:min-inline-0"
    >
      <slot />
    </div>
  </section>
</template>
