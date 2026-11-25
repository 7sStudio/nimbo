<!-- GitInput: Source Control's input box, as VS Code's: one field at the top of the window with its placeholder and the prompt under it ("Press Enter to confirm or Escape to cancel"); Enter sends the command with the text, Esc closes. -->
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import { useDispatcher } from "../commands/dispatch";
import Dialog from "../primitives/dialog/Dialog.vue";
import DialogContent from "../primitives/dialog/DialogContent.vue";
import DialogDescription from "../primitives/dialog/DialogDescription.vue";
import DialogTitle from "../primitives/dialog/DialogTitle.vue";
import type { Overlay } from "../store/overlay";
import { useUiStore } from "../store/ui";

const props = defineProps<{ overlay: Extract<Overlay, { kind: "gitInput" }> }>();
const ui = useUiStore();
const dispatcher = useDispatcher();
const text = ref(props.overlay.value ?? "");
const field = ref<HTMLInputElement | null>(null);
const ready = computed(() => props.overlay.optional === true || text.value.trim() !== "");
const close = () => {
  ui.overlay = null;
};
function submit(): void {
  if (!ready.value) return;
  const { command, args, key } = props.overlay;
  ui.overlay = null;
  void dispatcher.dispatch(command, { ...args, [key]: text.value.trim() });
}
onMounted(() => {
  field.value?.select();
});
</script>

<template>
  <Dialog :open="true" @update:open="close">
    <DialogContent
      :show-close-button="false"
      data-testid="git-input"
      data-overlay
      class="ui:inset-bs-[15vh] ui:translate-y-[0] ui:gap-1 ui:border-border-2 ui:bg-surface ui:p-1.5 ui:max-inline-[min(35rem,calc(100%-2rem))]"
    >
      <DialogTitle class="ui:visually-hidden">{{ props.overlay.placeholder }}</DialogTitle>
      <input
        ref="field"
        v-model="text"
        :placeholder="props.overlay.placeholder"
        :aria-label="props.overlay.placeholder"
        class="ui:rounded-control ui:border ui:border-accent ui:bg-bg ui:px-2 ui:py-1 ui:font-inherit ui:text-ui ui:text-fg ui:outline-none"
        @keydown.enter.prevent="submit"
      />
      <DialogDescription class="ui:m-0 ui:px-1 ui:text-small ui:text-muted">{{
        props.overlay.prompt
      }}</DialogDescription>
    </DialogContent>
  </Dialog>
</template>
