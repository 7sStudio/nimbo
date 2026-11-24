<!-- InspectorRail: the inspector hidden to its icons, each with a count: the pinned result while one is (its tooltip names the cell), variables are opened by name, then the functions the page can call and the routes listening. A click opens the inspector on that group. -->
<script setup lang="ts">
import { ArrowLeft, ArrowRightLeft, Pin, Variable, Waypoints } from "@lucide/vue";

import { keysShown } from "../keyboard/keymap";
import IconButton from "../primitives/icon-button/IconButton.vue";

const props = defineProps<{
  exports: number;
  routes: number;
  /** The cell whose result is pinned ("cell 5"), or null: its pin icon opens the inspector on it. */
  pinned: string | null;
  mac: boolean;
}>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();

const icon = "ui:block-4.5 ui:inline-4.5";
const count =
  "ui:pointer-events-none ui:absolute ui:end-0.5 ui:inset-bs-0 ui:font-mono ui:text-[0.5625rem] ui:font-medium ui:text-fg-2";
const some = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;
</script>

<template>
  <nav
    aria-label="Inspector"
    data-keys="own"
    class="ui:flex ui:flex-col ui:items-center ui:gap-1 ui:pbs-1 ui:pbe-2 ui:block-full"
  >
    <IconButton
      size="rail"
      side="left"
      label="Show the inspector"
      :keys="keysShown('ui.inspector.toggle', props.mac)"
      data-switch="inspector"
      @click="emit('command', 'ui.inspector.toggle')"
    >
      <ArrowLeft :class="icon" aria-hidden="true" />
    </IconButton>
    <IconButton
      v-if="props.pinned !== null"
      size="rail"
      side="left"
      :label="`Pinned result, from ${props.pinned}`"
      data-testid="rail-pinned"
      @click="emit('command', 'ui.panel.open', { which: 'pinned' })"
    >
      <Pin :class="icon" aria-hidden="true" />
    </IconButton>
    <IconButton
      size="rail"
      side="left"
      label="Variables"
      @click="emit('command', 'ui.panel.open', { which: 'variables' })"
    >
      <Variable :class="icon" aria-hidden="true" />
    </IconButton>
    <span class="ui:relative ui:flex">
      <IconButton
        size="rail"
        side="left"
        :label="`Bridge, ${some(props.exports, 'export', 'exports')} the page can call`"
        @click="emit('command', 'ui.panel.open', { which: 'bridge' })"
      >
        <ArrowRightLeft :class="icon" aria-hidden="true" />
      </IconButton>
      <span v-if="props.exports > 0" aria-hidden="true" :class="count">{{ props.exports }}</span>
    </span>
    <span class="ui:relative ui:flex">
      <IconButton
        size="rail"
        side="left"
        :label="`Routes, ${String(props.routes)} listening`"
        @click="emit('command', 'ui.panel.open', { which: 'routes' })"
      >
        <Waypoints :class="icon" aria-hidden="true" />
      </IconButton>
      <span v-if="props.routes > 0" aria-hidden="true" :class="count">{{ props.routes }}</span>
    </span>
  </nav>
</template>
