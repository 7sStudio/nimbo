<!-- TitleBar: the window's top row on both pages, as VS Code and Cursor lay it out: the app's name (a link to Home from every page and from Settings) and the menu bar on the left, the command center in the middle (it shows where you are and opens the palette), Feedback Mode's toggle (pressed while it is on) and the page's own actions on the right. -->
<script setup lang="ts">
import { MessageSquarePlus, Search } from "@lucide/vue";
import { computed } from "vue";

import { keysShown } from "../keyboard/keymap";
import IconButton from "../primitives/icon-button/IconButton.vue";
import { useFeedbackStore } from "../store/feedback";
import AppMenu from "./AppMenu.vue";
import type { AppMenuSpec } from "./appMenus";

const props = defineProps<{
  menus: readonly AppMenuSpec[];
  /** What the command center shows: the workspace on Home, the notebook on its page. */
  place: string;
  /** Its tooltip: the full path. */
  placeTitle: string;
  paletteOpen: boolean;
  mac: boolean;
  /** Changes are not on disk yet: a dot at the command center's end, in its own space, so nothing moves. */
  dirty?: boolean;
}>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();
defineSlots<{ default?: () => unknown }>();
/** The palette's keys as the user bound them (their own keys included), for the command center's tooltip. */
const paletteKeys = computed(() => keysShown("ui.palette.open", props.mac));
const feedback = useFeedbackStore();
</script>

<template>
  <header
    class="ui:grid ui:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] ui:items-center ui:gap-4 ui:ps-3 ui:pe-2 ui:block-full ui:min-inline-0"
  >
    <div class="ui:flex ui:items-center ui:gap-2 ui:min-inline-0">
      <button
        type="button"
        data-testid="wordmark"
        title="Go to Home"
        class="ui:-ms-1 ui:me-1 ui:shrink-0 ui:cursor-pointer ui:rounded-small ui:border ui:border-transparent ui:bg-transparent ui:px-1 ui:font-inherit ui:text-[0.9375rem] ui:font-semibold ui:tracking-[-0.02em] ui:text-fg ui:hover:bg-well ui:focus-visible:border-accent"
        @click="emit('command', 'ui.home.open')"
      >
        nimbo
      </button>
      <AppMenu
        :menus="props.menus"
        :mac="props.mac"
        @command="(id, args) => emit('command', id, args)"
      />
    </div>
    <button
      type="button"
      data-testid="command-input"
      aria-haspopup="dialog"
      :aria-expanded="props.paletteOpen"
      :aria-label="`${props.place}, open the command palette`"
      :title="paletteKeys === undefined ? props.placeTitle : `${props.placeTitle} (${paletteKeys})`"
      class="ui:relative ui:flex ui:cursor-pointer ui:items-center ui:justify-center ui:gap-2 ui:rounded-control ui:border ui:border-border ui:bg-side ui:px-2.5 ui:text-fg-2 ui:block-6.5 ui:inline-[clamp(16rem,30vw,32rem)] ui:hover:bg-sheet ui:hover:text-fg ui:focus-visible:border-accent"
      @click="emit('command', 'ui.palette.open')"
    >
      <Search class="ui:shrink-0 ui:text-muted ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
      <span class="ui:ellipsis" data-testid="place">{{ props.place }}</span>
      <span
        v-if="props.dirty"
        role="img"
        aria-label="Unsaved changes"
        title="Unsaved changes"
        data-testid="dirty"
        class="ui:absolute ui:inset-e-2.5 ui:rounded-[1em] ui:bg-fg-2 ui:block-1.5 ui:inline-1.5"
      />
    </button>
    <div class="ui:flex ui:items-center ui:justify-end ui:gap-1.5 ui:min-inline-0">
      <IconButton
        label="Feedback Mode"
        data-testid="feedback-toggle"
        :keys="keysShown('ui.feedback.toggle', props.mac)"
        :pressed="feedback.on"
        data-tone="hot"
        class="ui:data-[tone]:aria-pressed:bg-well ui:data-[tone]:aria-pressed:text-hot"
        @click="emit('command', 'ui.feedback.toggle')"
      >
        <MessageSquarePlus class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
      </IconButton>
      <slot />
    </div>
  </header>
</template>
