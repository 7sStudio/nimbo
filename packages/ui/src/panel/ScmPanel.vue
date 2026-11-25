<!-- ScmPanel: the notebook page's Source Control view in the side panel: its head (Source Control, Refresh, More Actions, Hide) and the view. -->
<script setup lang="ts">
import { RefreshCw } from "@lucide/vue";

import { useDispatcher } from "../commands/dispatch";
import { isMac } from "../keyboard/modes";
import IconButton from "../primitives/icon-button/IconButton.vue";
import ScmMenu from "./ScmMenu.vue";
import SourceControlView from "./SourceControlView.vue";
import ViewHead from "./ViewHead.vue";

const dispatcher = useDispatcher();
const mac = isMac(navigator.userAgent);
const run = (id: string, args?: Record<string, unknown>) => void dispatcher.dispatch(id, args);
</script>

<template>
  <ViewHead id="side-title" title="Source Control" region="side">
    <span class="ui:flex-1" />
    <IconButton label="Refresh" class="ui:block-6 ui:inline-6" @click="run('ui.git.refresh')">
      <RefreshCw class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
    </IconButton>
    <ScmMenu :mac="mac" @command="run" />
  </ViewHead>
  <SourceControlView :mac="mac" @command="run" />
</template>
