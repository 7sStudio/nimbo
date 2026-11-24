<!-- ConfirmDialog: the one confirm, a restart while a cell runs: "Cell 4 is running. Restart anyway?" Cancel keeps the run (and has the focus first); Restart sends the restart again, answered. -->
<script setup lang="ts">
import { computed } from "vue";

import { useDispatcher } from "../commands/dispatch";
import Button from "../primitives/button/Button.vue";
import type { Overlay } from "../store/overlay";
import { useNotebookStore } from "../store/notebook";
import { useUiStore } from "../store/ui";
import OverlayDialog from "./OverlayDialog.vue";

const props = defineProps<{ overlay: Extract<Overlay, { kind: "confirmRestart" }> }>();
const dispatcher = useDispatcher();
const notebook = useNotebookStore();
const ui = useUiStore();
const number = computed(
  () => notebook.cellsInOrder.findIndex((cell) => cell.id === props.overlay.running) + 1,
);
/** The run may end while the question is open: the title then says so, and Restart still restarts. */
const title = computed(() => {
  const which = number.value > 0 ? `Cell ${String(number.value)}` : "A cell";
  const cell = notebook.cellsInOrder.find((each) => each.id === props.overlay.running);
  return notebook.runningCell === props.overlay.running || cell?.status === "running"
    ? `${which} is running`
    : `${which} has finished`;
});
const cancel = () => {
  ui.overlay = null;
};
function restart(): void {
  ui.overlay = null;
  void dispatcher.dispatch("kernel.restart", { all: props.overlay.all, confirmed: true });
}
</script>

<template>
  <OverlayDialog
    :overlay="props.overlay"
    :title="title"
    role="alertdialog"
    :description="
      props.overlay.all
        ? 'Restart anyway? The runs stop, and the kernel and the page\'s realm start again.'
        : 'Restart anyway? The run stops, and the kernel starts again.'
    "
  >
    <template #footer>
      <Button @click="cancel">Cancel</Button>
      <Button variant="danger" data-testid="confirm-restart" @click="restart">{{
        props.overlay.all ? "Restart all" : "Restart"
      }}</Button>
    </template>
  </OverlayDialog>
</template>
