<!-- ConfirmNotebook: the Home page's confirm ('s ConfirmDialog, on OverlayDialog): before a notebook is deleted ("Delete demo.jsnb?", its kernel stopped first when open), and before a busy kernel is stopped ("demo.jsnb is running"); an open notebook is renamed without closing it (07 §5). Cancel has the focus first and keeps everything; the action sends the command again, answered. -->
<script setup lang="ts">
import { computed } from "vue";

import { useDispatcher } from "../commands/dispatch";
import OverlayDialog from "../overlays/OverlayDialog.vue";
import Button from "../primitives/button/Button.vue";
import { useHomeStore } from "../store/home";
import type { Overlay } from "../store/overlay";
import { useUiStore } from "../store/ui";

const props = defineProps<{ overlay: Extract<Overlay, { kind: "confirmNotebook" }> }>();
const dispatcher = useDispatcher();
const home = useHomeStore();
const ui = useUiStore();
const open = computed(() =>
  home.notebooks.some((each) => each.path === props.overlay.path && each.open),
);
const words = computed(() => {
  const { action, path } = props.overlay;
  if (action === "delete")
    return {
      title: `Delete ${path}?`,
      description: open.value
        ? "Its kernel stops, then the file is removed from the workspace. This cannot be undone."
        : "The file is removed from the workspace. This cannot be undone.",
      button: "Delete",
    };
  return {
    title: `${path} is running`,
    description: "Stop anyway? The run stops and the notebook's kernel shuts down.",
    button: "Stop",
  };
});
const cancel = () => {
  ui.overlay = null;
};
function confirm(): void {
  const { action, path } = props.overlay;
  ui.overlay = null;
  const id = action === "delete" ? "ui.notebook.delete" : "ui.notebook.close";
  void dispatcher.dispatch(id, { path, confirmed: true });
}
</script>

<template>
  <OverlayDialog
    :overlay="props.overlay"
    :title="words.title"
    role="alertdialog"
    :description="words.description"
  >
    <template #footer>
      <Button @click="cancel">Cancel</Button>
      <Button variant="danger" data-testid="confirm-notebook" @click="confirm">{{
        words.button
      }}</Button>
    </template>
  </OverlayDialog>
</template>
