<!-- A DOM output: the live container on the attached page (the host passes it in the default
slot), or the html snapshot elsewhere, in an iframe sandboxed with no scripts and no same origin, whose document takes the page's
theme (model/frameDoc.ts). -->
<script setup lang="ts">
import { frameDoc } from "../model/frameDoc.js";

defineProps<{ readonly html: string; readonly text: string }>();
defineSlots<{ default?: () => unknown }>();
</script>

<template>
  <!-- the host's live container inherits color-scheme and nothing else (08 §7): live-slot stops every
  inherited property here (utilities.css), and no rule of the viewer matches [data-live] or what it holds -->
  <div v-if="$slots.default" data-part="dom" data-live="" class="ov:live-slot">
    <slot />
  </div>
  <iframe
    v-else
    data-part="dom"
    class="ov:block ov:block-[min(var(--max-height,15rem),15rem)] ov:inline-full ov:border-0 ov:bg-transparent"
    sandbox=""
    :srcdoc="frameDoc(html)"
    :title="text === '' ? 'DOM snapshot' : `DOM snapshot: ${text.slice(0, 80)}`"
  />
</template>
