<!-- SettingsLeaveDialog: closing Settings or leaving the page while Settings (JSON) holds unsaved text, as VS Code asks about a dirty settings.json: the question, the close button as Cancel, then Don't Save and Save. Save writes each file whose text is unsaved, unless it changed on disk since or does not parse (then Settings (JSON) stays open with a toast saying why); Don't Save drops the text. Either then runs the command that asked again. -->
<script setup lang="ts">
import { computed } from "vue";

import { useDispatcher } from "../commands/dispatch";
import Button from "../primitives/button/Button.vue";
import type { Overlay } from "../store/overlay";
import type { Scope } from "../store/settings";
import { useSettingsStore } from "../store/settings";
import { useUiStore } from "../store/ui";
import OverlayDialog from "./OverlayDialog.vue";

const props = defineProps<{ overlay: Extract<Overlay, { kind: "confirmSettings" }> }>();
const dispatcher = useDispatcher();
const settings = useSettingsStore();
const ui = useUiStore();
const scopes = computed(() => ui.settingsUnsavedScopes());
const title = computed(() =>
  scopes.value.length === 1
    ? `Save changes to ${scopes.value[0] === "workspace" ? "the workspace's" : "your"} settings.json?`
    : "Save changes to both settings.json files?",
);

const again = () => dispatcher.dispatch(props.overlay.command, props.overlay.args);

/** Writes one file's unsaved text; the reason it was not written, or null. */
async function write(scope: Scope): Promise<string | null> {
  const unsaved = ui.settingsUnsaved[scope];
  if (unsaved === undefined) return null;
  const disk = await settings.file(scope);
  if (disk !== undefined && disk.text !== unsaved.base)
    return "The file changed on disk. Save again to overwrite it, or Revert to load it.";
  const refused = await settings.writeFile(scope, unsaved.text);
  if (refused !== null) return refused;
  ui.forgetSettings(scope);
  return null;
}
async function save(): Promise<void> {
  ui.overlay = null;
  for (const scope of scopes.value) {
    const refused = await write(scope);
    if (refused !== null) {
      ui.page = "settings";
      ui.pageJson = true;
      ui.toast({ kind: "error", title: "Settings not saved", text: refused.split("\n")[0] });
      return;
    }
  }
  await again();
}
async function discard(): Promise<void> {
  ui.overlay = null;
  ui.settingsUnsaved = {};
  await again();
}
</script>

<template>
  <OverlayDialog
    :overlay="props.overlay"
    :title="title"
    description="Unsaved changes will be lost."
    role="alertdialog"
    closable
  >
    <template #footer>
      <Button variant="outline" data-testid="settings-leave-discard" @click="discard"
        >Don't Save</Button
      >
      <Button variant="primary" data-testid="settings-leave-save" data-autofocus @click="save"
        >Save</Button
      >
    </template>
  </OverlayDialog>
</template>
