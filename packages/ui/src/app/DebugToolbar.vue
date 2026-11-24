<!-- DebugToolbar: VS Code's floating debug toolbar over the notebook while the debugger is attached: Continue or Pause, Step Over, Step Into, Step Out, Restart (the kernel), Stop (the run). A chunk of its own, loaded the first time the debugger attaches. -->
<script setup lang="ts">
import {
  ArrowDownToDot,
  ArrowUpFromDot,
  Pause,
  Play,
  RedoDot,
  RotateCcw,
  Square,
} from "@lucide/vue";
import type { Component } from "vue";
import { computed } from "vue";

import { useDispatcher } from "../commands/dispatch";
import { keysShown } from "../keyboard/keymap";
import { isMac } from "../keyboard/modes";
import IconButton from "../primitives/icon-button/IconButton.vue";
import { useDebugStore } from "../store/debug";

const dispatcher = useDispatcher();
const debug = useDebugStore();
const mac = isMac(navigator.userAgent);
const paused = computed(() => debug.state.state === "paused");

type Button = {
  readonly id: string;
  readonly label: string;
  readonly icon: Component;
  readonly args?: Record<string, unknown>;
  readonly tone?: string;
};
const buttons = computed<readonly Button[]>(() => [
  paused.value
    ? { id: "ui.debug.continue", label: "Continue", icon: Play, tone: "ui:text-ok-text" }
    : { id: "ui.debug.pause", label: "Pause", icon: Pause, tone: "ui:text-client-text" },
  { id: "ui.debug.stepOver", label: "Step Over", icon: RedoDot, tone: "ui:text-client-text" },
  {
    id: "ui.debug.stepInto",
    label: "Step Into",
    icon: ArrowDownToDot,
    tone: "ui:text-client-text",
  },
  { id: "ui.debug.stepOut", label: "Step Out", icon: ArrowUpFromDot, tone: "ui:text-client-text" },
  { id: "kernel.restart", label: "Restart Kernel", icon: RotateCcw, tone: "ui:text-ok-text" },
  { id: "ui.debug.stop", label: "Stop", icon: Square, tone: "ui:text-err-text" },
]);
const keysOf = (button: Button) => keysShown(button.id, mac, button.args);
</script>

<template>
  <div
    role="toolbar"
    aria-label="Debug"
    data-testid="debug-toolbar"
    data-keys="own"
    class="ui:pointer-events-auto ui:flex ui:items-center ui:gap-0.5 ui:rounded-control ui:border ui:border-border ui:bg-sheet ui:p-0.5 ui:shadow-pop"
  >
    <IconButton
      v-for="button in buttons"
      :key="button.id"
      :label="button.label"
      :keys="keysOf(button)"
      :data-debug="button.id"
      :disabled="!dispatcher.available(button.id, button.args)"
      :class="button.tone"
      @click="dispatcher.dispatch(button.id, button.args)"
    >
      <component :is="button.icon" class="ui:block-4 ui:inline-4" aria-hidden="true" />
    </IconButton>
  </div>
</template>
