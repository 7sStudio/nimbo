<!-- The Raw view (Tree / Grid / Raw): the value's pretty JSON highlighted, or the kernel's repr as text; read-only and
cut at 256 KB with the size of what is left (copy and export give it all). -->
<script setup lang="ts">
import { computed } from "vue";

import { thousands } from "../model/preview.js";
import { rawLimit, rawLines } from "./rawView.js";
import { tokenColor } from "./classes/tokens.js";

const props = defineProps<{
  readonly text: string;
  readonly json: boolean;
  readonly label: string;
}>();
const lines = computed(() => rawLines(props.text, props.json));
const rest = computed(() => Math.max(0, props.text.length - rawLimit));
</script>

<template>
  <pre
    data-part="raw"
    class="ov:m-0 ov:max-block-[var(--max-height,none)] ov:overflow-auto ov:px-2 ov:py-1 ov:font-mono ov:text-value ov:leading-code ov:whitespace-pre ov:in-data-[part=dialog]:min-block-0 ov:in-data-[part=dialog]:flex-1"
    tabindex="0"
    :aria-label="label"
  ><template
    v-for="line in lines"
    :key="line.start"
  ><span v-for="token in line.tokens" :key="token.start" :data-token="token.kind" :class="tokenColor[token.kind]">{{ token.text }}</span>
</template></pre>
  <p v-if="rest > 0" data-part="raw-rest" class="ov:m-0 ov:px-2 ov:py-1 ov:text-meta ov:text-fg-2">
    {{ thousands(rest) }} more characters not shown, copy or export to get all of it
  </p>
</template>
