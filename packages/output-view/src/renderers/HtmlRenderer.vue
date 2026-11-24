<!-- display.html ("text/html in v1"): the markup in an iframe sandboxed with no scripts, no same
origin, no forms and no popups, so a cell's HTML can never reach the notebook; its document takes the page's theme (model/frameDoc.ts). -->
<script setup lang="ts">
import { computed } from "vue";

import { frameDoc } from "../model/frameDoc.js";
import type { ViewInput } from "../model/output.js";

const props = defineProps<{ readonly output: ViewInput }>();
const html = computed(() => frameDoc(props.output.kind === "display" ? props.output.data : ""));
</script>

<template>
  <!-- the cap when one applies, never more than the default cap (03 §4.10), both set by OutputView -->
  <iframe
    data-part="html"
    class="ov:block ov:block-[min(var(--max-height,var(--default-cap)),var(--default-cap))] ov:inline-full ov:border-0 ov:bg-transparent"
    sandbox=""
    :srcdoc="html"
    title="HTML output"
  />
</template>
