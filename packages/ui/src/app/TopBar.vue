<!-- TopBar: the notebook page's title bar (TitleBar): the menus and the command center naming the notebook (a dot at its end while changes are not on disk, as VS Code marks a dirty editor; a failed or conflicting save has its banner). The kernel's and the runs' actions live in the notebook's own toolbar (NotebookToolbar), as VS Code's. Every control dispatches a command id. -->
<script setup lang="ts">
import { computed } from "vue";

import TitleBar from "./TitleBar.vue";
import type { AppMenuSpec } from "./appMenus";
import type { TopBarModel } from "./models";

const props = defineProps<{ model: TopBarModel; menus: readonly AppMenuSpec[]; mac: boolean }>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();

const place = computed(() => props.model.file);
const placeTitle = computed(() =>
  props.model.folder === "" ? props.model.file : `${props.model.folder}/${props.model.file}`,
);
const run = (id: string, args?: Record<string, unknown>) => {
  emit("command", id, args);
};
</script>

<template>
  <TitleBar
    :menus="props.menus"
    :place="place"
    :place-title="placeTitle"
    :palette-open="props.model.paletteOpen"
    :mac="props.mac"
    :dirty="props.model.save !== 'saved'"
    @command="run"
  >
    <span data-testid="save-state" :data-save="props.model.save" class="ui:visually-hidden">{{
      props.model.save
    }}</span>
  </TitleBar>
</template>
