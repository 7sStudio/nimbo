<!-- ViewHead: the first row of a side view, of the inspector or of the bottom panel: its title (the heading the region is named by), the view's own controls, and the icon that hides the region (its key in the tooltip), as VS Code puts it on the panel itself. -->
<script setup lang="ts">
import { PanelBottomClose, PanelLeftClose, PanelRightClose } from "@lucide/vue";

import { useDispatcher } from "../commands/dispatch";
import { keysFor, keyWords } from "../keyboard/keymap";
import { isMac } from "../keyboard/modes";
import IconButton from "../primitives/icon-button/IconButton.vue";
import type { Region } from "../store/layout";

const props = defineProps<{
  /** The heading's id, which the region's aria-labelledby names. */
  id: string;
  title: string;
  region: Region;
  /** The title is for a screen reader alone: the region's own controls (the bottom panel's tabs) say what it is. */
  quiet?: boolean;
}>();
const dispatcher = useDispatcher();
const hides = {
  side: { command: "ui.panel.close", keysOf: "ui.panel.toggle", icon: PanelLeftClose },
  inspector: {
    command: "ui.inspector.toggle",
    keysOf: "ui.inspector.toggle",
    icon: PanelRightClose,
  },
  bottom: { command: "ui.bottom.toggle", keysOf: "ui.bottom.toggle", icon: PanelBottomClose },
} as const;
const mac = isMac(navigator.userAgent);
const keys = () => {
  const bound = keysFor(hides[props.region].keysOf);
  return bound === undefined ? undefined : keyWords(bound, mac);
};
/** Hides the region and gives the focus to the control that shows it again, never to <body>; the hidden inspector's
 * rail is a chunk of its own, so the focus waits a few frames for it. */
async function hide(): Promise<void> {
  await dispatcher.dispatch(hides[props.region].command);
  for (let frame = 0; frame < 30; frame += 1) {
    const target = document.querySelector<HTMLElement>(`[data-switch="${props.region}"]`);
    if (target !== null) {
      target.focus();
      return;
    }
    await new Promise((done) => requestAnimationFrame(done));
  }
}
</script>

<template>
  <header class="ui:flex ui:shrink-0 ui:items-center ui:gap-2 ui:block-8.5 ui:min-inline-0">
    <h2
      :id="props.id"
      :class="
        props.quiet
          ? 'ui:visually-hidden'
          : 'ui:tracking-wide ui:m-0 ui:text-tiny ui:font-semibold ui:whitespace-nowrap ui:text-fg-2 ui:uppercase'
      "
    >
      {{ props.title }}
    </h2>
    <span class="ui:flex ui:flex-1 ui:items-center ui:gap-2 ui:min-inline-0"><slot /></span>
    <IconButton
      :label="`Hide ${props.title}`"
      :keys="keys()"
      :data-hide="props.region"
      class="ui:block-6 ui:inline-6"
      @click="hide"
    >
      <component
        :is="hides[props.region].icon"
        class="ui:block-3.5 ui:inline-3.5"
        aria-hidden="true"
      />
    </IconButton>
  </header>
</template>
