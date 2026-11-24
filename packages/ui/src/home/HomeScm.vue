<!-- HomeScm: Home's Source Control view in the side panel: its head (Source Control, Refresh, Hide) and the view the notebook page shows too. -->
<script setup lang="ts">
import { PanelLeftClose, RefreshCw } from "@lucide/vue";

import IconButton from "../primitives/icon-button/IconButton.vue";
import SourceControlView from "../panel/SourceControlView.vue";

const props = defineProps<{ mac: boolean }>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();
const send = (id: string, args?: Record<string, unknown>) => {
  emit("command", id, args);
};
const icon = "ui:block-3.5 ui:inline-3.5";
</script>

<template>
  <header class="ui:flex ui:shrink-0 ui:items-center ui:gap-2 ui:ps-1 ui:block-8.5 ui:min-inline-0">
    <h2
      id="side-title"
      class="ui:tracking-wide ui:m-0 ui:flex-1 ui:text-tiny ui:font-semibold ui:text-fg-2 ui:uppercase"
    >
      Source Control
    </h2>
    <IconButton label="Refresh" class="ui:block-6 ui:inline-6" @click="send('ui.git.refresh')">
      <RefreshCw :class="icon" aria-hidden="true" />
    </IconButton>
    <IconButton
      label="Hide Source Control"
      data-hide="side"
      class="ui:block-6 ui:inline-6"
      @click="send('ui.home.side.toggle')"
    >
      <PanelLeftClose :class="icon" aria-hidden="true" />
    </IconButton>
  </header>
  <SourceControlView :mac="props.mac" @command="send" />
</template>
