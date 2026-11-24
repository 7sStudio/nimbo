<!-- PanelToggle: VS Code's Toggle Panel at the status bar's right end, so a hidden bottom panel always has a way back. The icon draws the panel whole while it shows and dashed while hidden (aria-pressed); the tooltip carries the key (Cmd J), and View > Panel runs the same command. It is the bottom region's data-switch: hiding the panel from its own icon puts the focus here. -->
<script setup lang="ts">
import { PanelBottom, PanelBottomDashed } from "@lucide/vue";

import { keysShown } from "../keyboard/keymap";
import { isMac } from "../keyboard/modes";
import Kbd from "../primitives/kbd/Kbd.vue";
import Tooltip from "../primitives/tooltip/Tooltip.vue";
import TooltipContent from "../primitives/tooltip/TooltipContent.vue";
import TooltipTrigger from "../primitives/tooltip/TooltipTrigger.vue";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ command: [id: string] }>();
// the root is the tooltip, which renders no element: the status bar's class belongs on the button
defineOptions({ inheritAttrs: false });

const keys = keysShown("ui.bottom.toggle", isMac(navigator.userAgent));
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <button
        type="button"
        v-bind="$attrs"
        data-switch="bottom"
        data-testid="status-panel"
        aria-label="Toggle Panel"
        :aria-pressed="props.open"
        :class="props.open ? 'ui:text-fg-2' : ''"
        @click="emit('command', 'ui.bottom.toggle')"
      >
        <component
          :is="props.open ? PanelBottom : PanelBottomDashed"
          class="ui:block-3.5 ui:inline-3.5"
          aria-hidden="true"
        />
      </button>
    </TooltipTrigger>
    <TooltipContent side="top">
      Toggle Panel
      <Kbd v-if="keys">{{ keys }}</Kbd>
    </TooltipContent>
  </Tooltip>
</template>
