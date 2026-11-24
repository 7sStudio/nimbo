<!-- DialogOverlay: the dimmed backdrop behind a dialog; shadcn-vue copy on our tokens. -->
<script setup lang="ts">
import type { DialogOverlayProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { DialogOverlay } from "reka-ui";
import { cn } from "../cn";

const props = defineProps<DialogOverlayProps & { class?: HTMLAttributes["class"] }>();

const delegatedProps = reactiveOmit(props, "class");
</script>

<template>
  <DialogOverlay
    data-slot="dialog-overlay"
    v-bind="delegatedProps"
    :class="cn('ui:fixed ui:inset-0 ui:z-(--z-overlay) ui:bg-scrim', props.class)"
  >
    <slot />
  </DialogOverlay>
</template>
