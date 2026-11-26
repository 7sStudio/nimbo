<!-- The find box (⌘F): the text, the counter, previous and next, the keys / values / both scope in full
screen, and close. ↩ and ⇧↩ step through the matches, Esc closes. -->
<script setup lang="ts">
import { onMounted, ref } from "vue";

import type { SearchScope } from "../model/search.js";
import IconButton from "./IconButton.vue";
import Segments from "./Segments.vue";
import { metaText } from "./classes/meta.js";
import { field } from "./classes/field.js";

defineProps<{
  readonly counter: string;
  readonly error?: string | undefined;
  /** Offers the keys / values / both scope (full screen). */
  readonly scopes?: boolean | undefined;
}>();
const text = defineModel<string>("text", { required: true });
const scope = defineModel<SearchScope>("scope", { default: "both" });
const emit = defineEmits<{ step: [direction: 1 | -1]; close: [] }>();
const input = ref<HTMLInputElement | null>(null);
const scopeOptions = (["keys", "values", "both"] as const).map((value) => ({
  value,
  label: value,
}));

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter") emit("step", event.shiftKey ? -1 : 1);
  else if (event.key === "Escape") emit("close");
  else return;
  event.preventDefault();
  event.stopPropagation();
}
onMounted(() => {
  input.value?.focus();
});
defineExpose({ focus: () => input.value?.select() });
</script>

<template>
  <div
    data-part="search"
    class="ov:inline-flex ov:min-inline-0 ov:flex-wrap ov:items-center ov:gap-1"
    role="search"
  >
    <input
      ref="input"
      v-model="text"
      type="text"
      data-part="search-input"
      :class="field"
      class="ov:inline-[16ch] ov:min-inline-[8ch] ov:flex-[1_1_16ch] ov:aria-invalid:border-err"
      placeholder="Find"
      aria-label="Find in output"
      spellcheck="false"
      :aria-invalid="error === undefined ? undefined : true"
      :title="error"
      @keydown="onKeydown"
    />
    <span data-part="count" :class="metaText" aria-live="polite">{{ counter }}</span>
    <Segments v-if="scopes" v-model="scope" label="Search in" :options="scopeOptions" />
    <IconButton label="Previous match" icon="up" shortcut="⇧↩" @click="emit('step', -1)" />
    <IconButton label="Next match" icon="down" shortcut="↩" @click="emit('step', 1)" />
    <IconButton label="Close find" icon="close" shortcut="Esc" @click="emit('close')" />
  </div>
</template>
