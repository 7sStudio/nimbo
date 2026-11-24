<!-- RenameField: a notebook's inline rename, as a file tree has it: one field holding the path with the name's stem selected; Enter renames, Escape cancels (Home's ui.escape), leaving the field renames when the path changed, else ends the rename and leaves the focus where it went. -->
<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";

import { useHomeStore } from "../store/home";
import { splitPath } from "../store/homeRows";

const props = defineProps<{ path: string }>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();

const home = useHomeStore();
const draft = ref(props.path);
const field = ref<HTMLInputElement | null>(null);
onMounted(async () => {
  await nextTick();
  field.value?.focus();
  // the name without .jsnb selected, as a file manager does
  const name = splitPath(props.path).name;
  field.value?.setSelectionRange(props.path.length - name.length, props.path.length - 5);
});
/** Enter: renames, or cancels when the path did not change (the focus going back as Escape gives it). */
function commit(): void {
  if (home.renaming !== props.path) return;
  const to = draft.value.trim();
  if (to === "" || to === props.path) emit("command", "ui.escape");
  else emit("command", "ui.notebook.rename", { path: props.path, to });
}
/** Leaving the field renames when the path changed, else ends the rename and leaves the focus where it went (the
 * palette, a click elsewhere): never Escape, which would close what took the focus. */
function left(): void {
  if (home.renaming !== props.path) return;
  const to = draft.value.trim();
  if (to === "" || to === props.path) home.renaming = null;
  else emit("command", "ui.notebook.rename", { path: props.path, to });
}
function keyed(event: KeyboardEvent): void {
  if (event.key !== "Enter") return;
  event.preventDefault();
  commit();
}
</script>

<template>
  <input
    ref="field"
    v-model="draft"
    data-testid="rename-field"
    :aria-label="`New path for ${props.path}`"
    class="ui:flex-1 ui:rounded-small ui:border ui:border-accent ui:bg-sheet ui:px-1 ui:font-mono ui:text-code ui:text-fg ui:block-[1.25rem] ui:min-inline-0"
    autocomplete="off"
    spellcheck="false"
    @keydown="keyed"
    @blur="left"
    @click.stop
    @dblclick.stop
  />
</template>
