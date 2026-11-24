<!-- TextInput: a one-line field with v-model (the boards' .input), at 28 or 24 px (1.75rem, 1.5rem); shadcn-vue's Input on our tokens. Its focus is the page's one focus ring (theme/reset.css), with no border of its own on top, so a focused field is no heavier than a focused button. -->
<script setup lang="ts">
import type { HTMLAttributes } from "vue";

import { cn } from "../cn";

const props = withDefaults(
  defineProps<{ size?: "default" | "sm"; class?: HTMLAttributes["class"] }>(),
  { size: "default" },
);
const model = defineModel<string>({ default: "" });
</script>

<template>
  <input
    v-model="model"
    data-slot="text-input"
    :class="
      cn(
        'ui:rounded-control ui:border ui:border-transparent ui:bg-sheet ui:px-2 ui:font-inherit ui:text-ellipsis ui:text-fg ui:min-inline-0 ui:placeholder:text-muted ui:disabled:opacity-45',
        props.size === 'sm' ? 'ui:text-tiny ui:block-5.5' : 'ui:text-small ui:block-6',
        props.class,
      )
    "
  />
</template>
