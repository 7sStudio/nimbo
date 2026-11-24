<!-- OverlayDialog: a Reka Dialog opened by the store: modal, focus trapped, closed by Esc, a click outside or its buttons, and the focus handed back to where it was. The title names it; the body and the footer are slots. -->
<script setup lang="ts">
import Dialog from "../primitives/dialog/Dialog.vue";
import DialogContent from "../primitives/dialog/DialogContent.vue";
import DialogDescription from "../primitives/dialog/DialogDescription.vue";
import DialogFooter from "../primitives/dialog/DialogFooter.vue";
import DialogHeader from "../primitives/dialog/DialogHeader.vue";
import DialogTitle from "../primitives/dialog/DialogTitle.vue";
import type { Overlay } from "../store/overlay";
import { useUiStore } from "../store/ui";
import { focusBack } from "./anchor";

const props = defineProps<{
  overlay: Overlay;
  title: string;
  description?: string;
  /** "alertdialog" for a question the user must answer. */
  role?: "dialog" | "alertdialog";
  /** The panel's width class (relative units). */
  width?: string;
  /** A close button at the top end, as shadcn's dialog has it: the dialog's Cancel. */
  closable?: boolean;
}>();
defineSlots<{ default?: () => unknown; footer: () => unknown }>();

const ui = useUiStore();
const opener = document.activeElement;
const close = (open: boolean) => {
  if (!open && ui.overlay === props.overlay) ui.overlay = null;
};
/** The control marked `data-autofocus` takes the focus first (the dialog's safe or main answer), else Reka's first. */
function focusFirst(event: Event): void {
  const target = event.target instanceof Element ? event.target : null;
  const marked = target?.querySelector<HTMLElement>("[data-autofocus]");
  if (!marked) return;
  event.preventDefault();
  marked.focus();
}
function returnFocus(event: Event): void {
  event.preventDefault();
  focusBack(props.overlay, opener, ui.selected)?.focus({ preventScroll: true });
}
</script>

<template>
  <Dialog :open="true" @update:open="close">
    <DialogContent
      :show-close-button="props.closable === true"
      data-overlay
      :role="props.role ?? 'dialog'"
      :class="props.width ?? 'ui:max-inline-[min(28rem,calc(100%-2rem))]'"
      @open-auto-focus="focusFirst"
      @close-auto-focus="returnFocus"
    >
      <DialogHeader>
        <DialogTitle>{{ props.title }}</DialogTitle>
        <DialogDescription v-if="props.description" class="ui:text-fg-2">{{
          props.description
        }}</DialogDescription>
      </DialogHeader>
      <slot />
      <DialogFooter>
        <slot name="footer" />
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
