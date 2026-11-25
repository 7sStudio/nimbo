<!-- GitAsk: Source Control's confirm of an action that can lose work, on OverlayDialog: VS Code's title and one line on what would be lost; Cancel has the focus first; the action sends its command, answered. -->
<script setup lang="ts">
import { useDispatcher } from "../commands/dispatch";
import OverlayDialog from "../overlays/OverlayDialog.vue";
import Button from "../primitives/button/Button.vue";
import type { Overlay } from "../store/overlay";
import { useUiStore } from "../store/ui";

const props = defineProps<{ overlay: Extract<Overlay, { kind: "gitAsk" }> }>();
const dispatcher = useDispatcher();
const ui = useUiStore();
const cancel = () => {
  ui.overlay = null;
};
function confirm(): void {
  const { command, args } = props.overlay;
  ui.overlay = null;
  void dispatcher.dispatch(command, args);
}
</script>

<template>
  <OverlayDialog
    :overlay="props.overlay"
    :title="props.overlay.title"
    role="alertdialog"
    :description="props.overlay.description"
  >
    <template #footer>
      <Button @click="cancel">Cancel</Button>
      <Button
        :variant="props.overlay.danger === true ? 'danger' : 'primary'"
        data-testid="git-ask"
        @click="confirm"
        >{{ props.overlay.button }}</Button
      >
    </template>
  </OverlayDialog>
</template>
