<!-- DialogContent: the dialog panel in a portal with its overlay and close button; shadcn-vue copy on our tokens. -->
<script setup lang="ts">
import type { DialogContentEmits, DialogContentProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { X } from "@lucide/vue";
import { reactiveOmit } from "@vueuse/core";
import { DialogClose, DialogContent, DialogPortal, useForwardPropsEmits } from "reka-ui";
import { cn } from "../cn";
import { overlayHost } from "../overlay";
import DialogOverlay from "./DialogOverlay.vue";

defineOptions({
  inheritAttrs: false,
});

const props = withDefaults(
  defineProps<
    DialogContentProps & { class?: HTMLAttributes["class"]; showCloseButton?: boolean }
  >(),
  {
    showCloseButton: true,
  },
);
const emits = defineEmits<DialogContentEmits>();

const delegatedProps = reactiveOmit(props, "class");

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <DialogPortal :to="overlayHost">
    <DialogOverlay />
    <DialogContent
      data-slot="dialog-content"
      v-bind="{ ...$attrs, ...forwarded }"
      :class="
        cn(
          'ui:fixed ui:inset-s-1/2 ui:inset-bs-1/2 ui:z-(--z-overlay) ui:grid ui:-translate-x-1/2 ui:-translate-y-1/2 ui:gap-4 ui:rounded-card ui:border ui:border-border ui:bg-bg ui:p-6 ui:shadow-pop ui:inline-full ui:max-inline-[calc(100%-2rem)]',
          props.class,
        )
      "
    >
      <slot />

      <DialogClose
        v-if="showCloseButton"
        data-slot="dialog-close"
        class="ui:absolute ui:inset-e-4 ui:inset-bs-4 ui:flex ui:cursor-pointer ui:items-center ui:justify-center ui:rounded-small ui:border ui:border-transparent ui:bg-transparent ui:p-0.5 ui:text-muted ui:hover:bg-surface-2 ui:hover:text-fg ui:focus-visible:border-accent ui:disabled:pointer-events-none"
      >
        <X class="ui:block-4 ui:inline-4" />
        <span class="ui:visually-hidden">Close</span>
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
