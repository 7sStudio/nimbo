<!-- TextDiff: one file's text diff, a read-only merge editor (mergeSetup.ts) side by side or inline, with its unchanged runs folded; Next and Previous Change step through its chunks. -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

import type { EditorLanguage } from "../editor/setup";
import type { DiffEditor } from "./mergeSetup";
import { mountDiff } from "./mergeSetup";

const props = defineProps<{
  before: string;
  after: string;
  language: EditorLanguage | null;
  sideBySide: boolean;
  label: string;
}>();
const host = ref<HTMLElement | null>(null);
let editor: DiffEditor | null = null;
let gone = false;
onMounted(async () => {
  if (host.value === null) return;
  const made = await mountDiff(
    host.value,
    { before: props.before, after: props.after },
    { language: props.language, sideBySide: props.sideBySide, label: props.label },
  );
  if (gone) made.destroy();
  else editor = made;
});
onBeforeUnmount(() => {
  gone = true;
  editor?.destroy();
});
defineExpose({ next: (by: 1 | -1) => editor?.next(by) ?? false });
</script>

<template>
  <div ref="host" data-testid="text-diff" class="ui:px-3 ui:py-3" />
</template>
