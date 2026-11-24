<!-- display.image: an <img> from the display's base64 data, SVG text as given, or a URL. -->
<script setup lang="ts">
import { computed } from "vue";

import type { ViewInput } from "../model/output.js";

const props = defineProps<{ readonly output: ViewInput }>();

/** A data: URL for the image: SVG markup as text, every other type as the base64 the display carries. */
const source = computed(() => {
  if (props.output.kind !== "display") return "";
  const { mime, data } = props.output;
  if (/^(https?:\/\/|data:image\/)/iu.test(data)) return data; // display.image of a URL shows it as linked
  return mime === "image/svg+xml" && data.trimStart().startsWith("<")
    ? `data:${mime};charset=utf-8,${encodeURIComponent(data)}`
    : `data:${mime};base64,${data}`;
});
</script>

<template>
  <img
    data-part="image"
    class="ov:mx-2 ov:my-1 ov:block ov:max-block-[var(--max-height,none)] ov:max-inline-full ov:object-contain"
    :src="source"
    alt="Image output"
  />
</template>
