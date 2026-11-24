<!-- Overlays: where the palette and the menus and dialogs of store/overlay.ts mount while open. Each is a chunk loaded the first time it opens, so the first load carries none of them; a chunk that cannot load (a daemon upgraded under the page) closes the overlay with a toast, and a menu whose cell is gone closes. -->
<script setup lang="ts">
import type { Component } from "vue";
import { defineAsyncComponent, watch } from "vue";

import { useFeedbackStore } from "../store/feedback";
import { useNotebookStore } from "../store/notebook";
import type { Overlay } from "../store/overlay";
import { useUiStore } from "../store/ui";

const ui = useUiStore();
const feedback = useFeedbackStore();
const notebook = useNotebookStore();
// Side effect: a menu whose cell is gone (an agent deleted it, a reload dropped it) closes rather than staying open
// with nothing in it.
watch(
  () => (ui.overlay !== null && "cell" in ui.overlay ? notebook.byId.has(ui.overlay.cell) : true),
  (present) => {
    if (!present) ui.overlay = null;
  },
);

function lazy(load: () => Promise<Component>): Component {
  return defineAsyncComponent({
    loader: load,
    onError: (error, _retry, fail) => {
      ui.overlay = null;
      ui.closePalette();
      ui.toast({
        kind: "error",
        title: "Could not open it",
        text: `Reload the page: ${error.message}`,
      });
      fail();
    },
  });
}

const palette = lazy(() => import("./CommandPalette.vue"));
const views: Readonly<Record<Overlay["kind"], Component>> = {
  cellMenu: lazy(() => import("./CellMenu.vue")),
  typeMenu: lazy(() => import("./TypeMenu.vue")),
  restartMenu: lazy(() => import("./RestartMenu.vue")),
  confirmRestart: lazy(() => import("./ConfirmDialog.vue")),
  agentDiff: lazy(() => import("./AgentDiff.vue")),
  runCompare: lazy(() => import("./RunCompare.vue")),
  confirmNotebook: lazy(() => import("../home/ConfirmNotebook.vue")),
  confirmGit: lazy(() => import("../panel/ConfirmGit.vue")),
  folderPicker: lazy(() => import("../home/FolderPicker.vue")),
  confirmLeave: lazy(() => import("./LeaveDialog.vue")),
  confirmSettings: lazy(() => import("./SettingsLeaveDialog.vue")),
  feedback: lazy(() => import("../feedback/FeedbackList.vue")),
  hint: lazy(() => import("./HintDialog.vue")),
};
const feedbackLayer = lazy(() => import("../feedback/FeedbackLayer.vue"));
</script>

<template>
  <component :is="palette" v-if="ui.palette.open" />
  <!-- feedback mode (Cmd Alt F): over everything, the dialogs included -->
  <component :is="feedbackLayer" v-if="feedback.on" />
  <!-- keyed by what it shows, so another cell's menu mounts afresh (its anchor, the focus to give back) -->
  <component
    :is="views[ui.overlay.kind]"
    v-if="ui.overlay !== null"
    :key="JSON.stringify(ui.overlay)"
    :overlay="ui.overlay"
  />
</template>
