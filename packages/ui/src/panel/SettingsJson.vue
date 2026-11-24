<!-- SettingsJson: Settings (JSON) or Keyboard Shortcuts (JSON) (`kind`), the user's or the workspace's settings.json or keybindings.json itself in an editor, as VS Code opens them: its path over it, the text as written (comments and keys nimbo does not know included), Save (Cmd S in the editor) writing it whole once it parses and its values are valid; a refusal says why under the path and writes nothing. A change made elsewhere shows while the view holds no unsaved text; unsaved text is never replaced, Revert loads the file, and a Save over a file changed on disk since asks for a second Save. -->
<script setup lang="ts">
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";

import { editorHighlight, editorTheme } from "../editor/theme";
import Button from "../primitives/button/Button.vue";
import type { Scope } from "../store/settings";
import { useKeybindingsStore } from "../store/keybindings";
import { useSettingsStore } from "../store/settings";
import { useUiStore } from "../store/ui";

const props = withDefaults(
  defineProps<{ scope: Scope; off: boolean; kind?: "settings" | "keybindings" }>(),
  { kind: "settings" },
);

const settingsStore = useSettingsStore();
const keybindingsStore = useKeybindingsStore();
/** The file's commands: settings.file and settings.writeFile, or keybindings.file and keybindings.writeFile. */
const settings = props.kind === "settings" ? settingsStore : keybindingsStore;
const ui = useUiStore();
const host = ref<HTMLElement | null>(null);
const view = shallowRef<EditorView | null>(null);
const path = ref("");
const saved = ref("");
const dirty = ref(false);
const error = ref<string | null>(null);

/** The unsaved text is written through to the ui store as it changes, so closing Settings or leaving the page can ask
 * about it (commands/app.ts askSettingsFirst), and a switch of file or view keeps it. */
function remember(text: string): void {
  if (props.kind === "keybindings") keybindingDrafts.set(props.scope, text);
  else ui.settingsUnsaved = { ...ui.settingsUnsaved, [props.scope]: { text, base: saved.value } };
}
/** The unsaved text this file's view left, if any. */
const unsavedText = (): string | undefined =>
  props.kind === "keybindings"
    ? keybindingDrafts.get(props.scope)
    : ui.settingsUnsaved[props.scope]?.text;
function forget(): void {
  if (props.kind === "keybindings") keybindingDrafts.delete(props.scope);
  else if (ui.settingsUnsaved[props.scope] !== undefined) ui.forgetSettings(props.scope);
}

/** The text on disk replaces the editor's (Revert, or a change made elsewhere while nothing here is unsaved). */
function show(text: string): void {
  const current = view.value;
  saved.value = text;
  if (current !== null && current.state.doc.toString() !== text)
    current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: text } });
  dirty.value = false;
  forget();
}

/** Reads the file again; shows it unless this view holds unsaved text (or `force`, Revert). */
async function reload(force = false): Promise<void> {
  if ((dirty.value && !force) || view.value === null) return;
  const file = await settings.file(props.scope);
  if (file === undefined || (dirty.value && !force)) return;
  error.value = null;
  show(file.text);
}

async function save(): Promise<void> {
  const text = view.value?.state.doc.toString();
  if (text === undefined || props.off) return;
  // the file changed on disk since it was read (a hand edit, a comment): never overwrite that unseen; a second Save
  // does, as VS Code's "Overwrite"
  const disk = await settings.file(props.scope);
  if (disk !== undefined && disk.text !== saved.value) {
    saved.value = disk.text;
    error.value = "The file changed on disk. Save again to overwrite it, or Revert to load it.";
    return;
  }
  error.value = await settings.writeFile(props.scope, text);
  if (error.value === null) {
    saved.value = text;
    dirty.value = false;
    forget();
  }
}

/** The editor's extensions: JSONC as JavaScript, the page's theme, Cmd S saving this file (never the notebook). */
const extensions = () => [
  lineNumbers(),
  history(),
  javascript(),
  syntaxHighlighting(editorHighlight),
  editorTheme,
  EditorView.lineWrapping,
  EditorState.readOnly.of(props.off),
  keymap.of([
    {
      key: "Mod-s",
      run: () => {
        void save();
        return true;
      },
    },
    ...defaultKeymap,
    ...historyKeymap,
  ]),
  // the page's own keys never see Cmd S here
  EditorView.domEventHandlers({
    keydown: (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") event.stopPropagation();
      return false;
    },
  }),
  EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    const text = update.state.doc.toString();
    dirty.value = text !== saved.value;
    if (dirty.value) remember(text);
    else forget();
  }),
];

onMounted(async () => {
  const file = await settings.file(props.scope);
  path.value = file?.path ?? "";
  saved.value = file?.text ?? "";
  if (host.value === null) return;
  const draft = unsavedText();
  view.value = new EditorView({
    parent: host.value,
    state: EditorState.create({ doc: draft ?? saved.value, extensions: extensions() }),
  });
  dirty.value = draft !== undefined && draft !== saved.value;
  if (!dirty.value) forget();
  view.value.focus();
});
// a change made elsewhere (the UI tab, the CLI, an agent, a hand edit) shows here while this view holds no unsaved text,
// as VS Code reloads a settings.json that is not dirty; a comment-only edit changes no value, so the window's focus
// reads the file again too
watch(
  () => (props.kind === "settings" ? settingsStore.values : keybindingsStore.files),
  () => {
    void reload();
  },
);
const onFocus = (): void => {
  void reload();
};
onMounted(() => {
  globalThis.addEventListener("focus", onFocus);
});
onBeforeUnmount(() => {
  globalThis.removeEventListener("focus", onFocus);
});
// Don't Save in the leave dialog drops the unsaved text: the view shows the file again
watch(
  () => ui.settingsUnsaved[props.scope],
  (unsaved) => {
    if (unsaved === undefined && dirty.value) void reload(true);
  },
);
// unsaved text survives a switch to the other file or to the UI view (it stays in the ui store), as an editor tab
// keeps its changes
onBeforeUnmount(() => {
  view.value?.destroy();
});
</script>

<script lang="ts">
/** Keyboard Shortcuts (JSON)'s unsaved text per file, kept while the page lives (the settings' is in the ui store). */
const keybindingDrafts = new Map<string, string>();
</script>

<template>
  <div class="ui:flex ui:flex-1 ui:flex-col ui:gap-2 ui:pbs-3 ui:min-block-0">
    <div class="ui:flex ui:items-center ui:gap-3">
      <span
        class="ui:flex-1 ui:ellipsis ui:font-mono ui:text-tiny ui:text-muted ui:min-inline-0"
        :title="path"
        >{{ path }}</span
      >
      <Button
        v-if="dirty"
        size="sm"
        data-testid="settings-json-revert"
        :disabled="props.off"
        @click="reload(true)"
        >Revert</Button
      >
      <Button
        size="sm"
        variant="primary"
        data-testid="settings-json-save"
        :disabled="!dirty || props.off"
        @click="save"
        >Save</Button
      >
    </div>
    <p
      v-if="error !== null"
      role="alert"
      class="ui:m-0 ui:text-small ui:whitespace-pre-line ui:text-err-text"
    >
      {{ error }}
    </p>
    <div
      ref="host"
      data-testid="settings-json-editor"
      class="ui:flex-1 ui:overflow-auto ui:rounded-control ui:border ui:border-border ui:bg-sheet ui:min-block-0"
    />
  </div>
</template>
