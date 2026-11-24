<!-- HintDialog: a language hint in full (hover, parameter hints, a completion's details), opened from the expand button at its popup's top end, as JetBrains opens its documentation popup larger: the name as the title, the signature in syntax colours and the documentation as prose, scrolling inside the dialog. -->
<script setup lang="ts">
import { clickedLink } from "../editor/language/links";
import type { Overlay } from "../store/overlay";
import { useUiStore } from "../store/ui";
import OverlayDialog from "./OverlayDialog.vue";

const props = defineProps<{ overlay: Extract<Overlay, { kind: "hint" }> }>();
const ui = useUiStore();
/** A link goes to its definition (the dialog closes for it) or opens its web page in a new tab. */
function follow(event: MouseEvent): void {
  const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (anchor !== null && !(anchor.getAttribute("href") ?? "").startsWith("http")) ui.overlay = null;
  clickedLink(event);
}
</script>

<template>
  <!-- eslint-disable vue/no-v-html -- the popup's own HTML: its code spans, and the documentation the language client sanitized with DOMPurify -->
  <OverlayDialog
    :overlay="props.overlay"
    :title="props.overlay.title"
    width="ui:max-inline-[min(48rem,calc(100%-2rem))]"
    closable
  >
    <div
      data-testid="hint-full"
      class="ui:prose ui:overflow-y-auto ui:text-small ui:max-block-[70vh]"
      @click="follow"
      v-html="props.overlay.html"
    />
    <template #footer />
  </OverlayDialog>
</template>
