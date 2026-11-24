<!-- A button that reads as a word (a hint's action, "Show all", "Load next", Cancel, the query notes' exports): no frame,
11 px in the client's color, a pale wash under a pointer, whose fade chrome.css turns off for reduced motion. `part`
names it, a hint's action or the chrome's text button. -->
<script setup lang="ts">
import { textButton } from "./classes/textButton.js";

withDefaults(defineProps<{ readonly part?: "text-button" | "hint-action" | undefined }>(), {
  part: "text-button",
});
</script>

<template>
  <button type="button" :data-part="part" :class="textButton"><slot /></button>
</template>
