<!-- KeyCaps: keys as key caps, as VS Code's Keyboard Shortcuts editor draws them: each key of a combination in its own cap ("Cmd" "Shift" "P"), a chord's two combinations apart. Keys in plain words (keymap.ts keyWords), never glyphs. -->
<script setup lang="ts">
import { computed } from "vue";

import { keyWords } from "../keyboard/keymap";

const props = defineProps<{ keys: string; mac: boolean }>();
const combos = computed(() =>
  props.keys
    .split(" ")
    .map((combo) => combo.split(/\+(?=.)/u).map((part) => keyWords(part, props.mac))),
);
</script>

<template>
  <span
    class="ui:inline-flex ui:items-center ui:gap-2"
    :aria-label="keyWords(props.keys, props.mac)"
  >
    <span
      v-for="(combo, at) in combos"
      :key="at"
      class="ui:inline-flex ui:items-center ui:gap-0.5"
      aria-hidden="true"
    >
      <kbd
        v-for="(part, index) in combo"
        :key="index"
        class="ui:inline-flex ui:items-center ui:rounded-small ui:border ui:border-be-2 ui:border-border ui:bg-sheet ui:px-1.5 ui:font-sans ui:text-tiny ui:leading-none ui:text-fg ui:block-5"
        >{{ part }}</kbd
      >
    </span>
  </span>
</template>
