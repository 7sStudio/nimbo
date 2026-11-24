<!-- ConfirmGit: Source Control's confirms, on OverlayDialog as VS Code words them: "Discard changes in demo.jsnb?" (or "in 3 files?") before a discard, which cannot be undone, "Delete notes.txt?" when every file is untracked; "Stage all changes and commit?" when Commit finds nothing staged. Cancel has the focus first; the action sends the command again, answered. -->
<script setup lang="ts">
import { computed } from "vue";

import { useDispatcher } from "../commands/dispatch";
import OverlayDialog from "../overlays/OverlayDialog.vue";
import Button from "../primitives/button/Button.vue";
import type { Overlay } from "../store/overlay";
import { useGitStore } from "../store/git";
import { useUiStore } from "../store/ui";

const props = defineProps<{ overlay: Extract<Overlay, { kind: "confirmGit" }> }>();
const dispatcher = useDispatcher();
const ui = useUiStore();
const git = useGitStore();
const words = computed(() => {
  const { action, paths } = props.overlay;
  if (action === "commitAll")
    return {
      title: "Stage all changes and commit?",
      description: "There are no staged changes.",
      button: "Stage All and Commit",
    };
  const which = paths.length === 1 ? (paths[0] ?? "") : `${String(paths.length)} files`;
  const untracked = new Set(
    (git.repo?.changes ?? [])
      .filter((change) => change.status === "untracked")
      .map((change) => change.path),
  );
  const deleted = paths.filter((path) => untracked.has(path)).length;
  if (deleted === paths.length)
    return {
      title: `Delete ${which}?`,
      description: "Untracked, so discarding deletes it. This cannot be undone.",
      button: paths.length === 1 ? "Delete File" : "Delete Files",
    };
  return {
    title: `Discard changes in ${which}?`,
    description:
      deleted === 0
        ? "This cannot be undone."
        : `This cannot be undone, and the ${String(deleted)} untracked ${deleted === 1 ? "file is" : "files are"} deleted.`,
    button: "Discard",
  };
});
const cancel = () => {
  ui.overlay = null;
};
function confirm(): void {
  const { action, paths } = props.overlay;
  ui.overlay = null;
  if (action === "discard") void dispatcher.dispatch("ui.git.discard", { paths, confirmed: true });
  else void dispatcher.dispatch("ui.git.commit", { all: true });
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
      <Button
        :variant="props.overlay.action === 'discard' ? 'danger' : 'default'"
        data-testid="confirm-git"
        @click="confirm"
        >{{ words.button }}</Button
      >
    </template>
  </OverlayDialog>
</template>
