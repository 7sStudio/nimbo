<!-- The viewer's one tooltip: the label and shortcut of the icon button under the pointer or focus, placed
at that button through Reka's `reference`, its text named by the controller's id for the button's aria-describedby,
and dismissed by Escape or a click like any Reka tooltip. -->
<script setup lang="ts">
import { TooltipContent, TooltipPortal, TooltipRoot } from "reka-ui";

import type { Tooltips } from "./tooltip.js";
import { shortcutWords } from "./tooltip.js";
import { TooltipId } from "./tooltipId.js";
import { tooltip } from "./classes/tooltip.js";

const props = defineProps<{
  readonly tips: Tooltips;
  readonly theme: "light" | "dark" | undefined;
}>();
const update = (open: boolean): void => {
  if (!open) props.tips.close();
};
</script>

<template>
  <TooltipRoot
    :open="tips.shown.value !== undefined"
    disable-hoverable-content
    @update:open="update"
  >
    <TooltipId :id="tips.id" />
    <TooltipPortal>
      <TooltipContent
        v-if="tips.shown.value"
        :reference="tips.shown.value.anchor"
        class="jsnb-ov"
        :class="tooltip"
        data-part="tooltip"
        :data-theme="theme"
        side="bottom"
        :side-offset="6"
      >
        {{ tips.shown.value.label
        }}<kbd
          v-if="tips.shown.value.shortcut"
          data-part="kbd"
          class="ov:ps-1.5 ov:font-sans ov:text-kbd ov:text-tip-muted"
          >{{ shortcutWords(tips.shown.value.shortcut) }}</kbd
        >
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>
