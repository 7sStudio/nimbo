<!-- LeaveDialog: going to Home with changes that are not on disk (a save that failed or conflicts, text typed and not sent), laid out as shadcn's dialog: the question and one line under it, the close button as Cancel, then Don't Save and Save (Overwrite in a conflict, as the conflict banner's). Don't Save drops the typed text and, after a failed or conflicting save, reloads the notebook from its file so the daemon's copy loses the unsaved edits, then goes. -->
<script setup lang="ts">
import { computed } from "vue";

import { useDispatcher } from "../commands/dispatch";
import Button from "../primitives/button/Button.vue";
import type { Overlay } from "../store/overlay";
import { useNotebookStore } from "../store/notebook";
import { useUiStore } from "../store/ui";
import OverlayDialog from "./OverlayDialog.vue";

const props = defineProps<{ overlay: Extract<Overlay, { kind: "confirmLeave" }> }>();
const dispatcher = useDispatcher();
const notebook = useNotebookStore();
const ui = useUiStore();
const conflict = computed(() => notebook.mirror.saveState === "conflict");
/** Edits the daemon holds and could not write: only then does Don't Save reload from the file (autosave writes the rest). */
const stuck = computed(() => conflict.value || notebook.mirror.saveState === "failed");

const leave = () => dispatcher.dispatch("ui.home.open", { confirmed: true });
/** Sends the typed text, then saves; a save that fails keeps the page (its banner says why). */
async function save(): Promise<void> {
  ui.overlay = null;
  await ui.flushDrafts.run();
  if ((await notebook.save(conflict.value)) !== undefined) await leave();
}
async function discard(): Promise<void> {
  ui.overlay = null;
  for (const cell of notebook.cellsInOrder) ui.setDraft(cell.id, null);
  if (stuck.value) await notebook.reload();
  await leave();
}
</script>

<template>
  <OverlayDialog
    :overlay="props.overlay"
    :title="`Save changes to ${notebook.pageName}?`"
    :description="
      conflict ? 'The file changed on disk since it was opened.' : 'Unsaved changes will be lost.'
    "
    role="alertdialog"
    closable
  >
    <template #footer>
      <Button variant="outline" data-testid="leave-discard" @click="discard">Don't Save</Button>
      <Button variant="primary" data-testid="leave-save" data-autofocus @click="save">{{
        conflict ? "Overwrite" : "Save"
      }}</Button>
    </template>
  </OverlayDialog>
</template>
