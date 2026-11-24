<!-- Toast: one notice in the stack, a status (its title and text), an optional action (Undo ⌘Z) and a close; Reka's ToastRoot on our tokens. Reka announces the toast once, its title, text and the action's alt text, through a live region of its own: the status here is aria-live="off", so a screen reader does not hear it twice. -->
<script setup lang="ts">
import { X } from "@lucide/vue";
import { ToastAction, ToastClose, ToastDescription, ToastRoot, ToastTitle } from "reka-ui";

const props = defineProps<{
  title: string;
  description?: string;
  /** The action's label and the words a screen reader hears for it (Reka's altText). */
  action?: { readonly label: string; readonly alt: string };
}>();
const open = defineModel<boolean>("open", { default: true });
defineEmits<{ act: [] }>();
</script>

<template>
  <ToastRoot
    v-model:open="open"
    data-slot="toast"
    class="ui:flex ui:items-center ui:gap-3 ui:rounded-card ui:border ui:border-border-2 ui:bg-bg ui:py-2.5 ui:ps-3.5 ui:pe-2 ui:text-ui ui:text-fg ui:shadow-pop ui:motion-safe:data-[state=open]:animate-enter"
  >
    <div
      role="status"
      aria-live="off"
      class="ui:flex ui:flex-1 ui:flex-col ui:gap-0.5 ui:min-inline-0"
    >
      <ToastTitle class="ui:font-medium">{{ props.title }}</ToastTitle>
      <ToastDescription v-if="props.description" class="ui:text-meta ui:text-muted">
        {{ props.description }}
      </ToastDescription>
    </div>
    <ToastAction v-if="props.action" :alt-text="props.action.alt" as-child>
      <button
        type="button"
        class="ui:cursor-pointer ui:rounded-control ui:border ui:border-border-2 ui:bg-surface ui:px-2 ui:text-small ui:font-medium ui:block-6 ui:hover:bg-surface-2 ui:focus-visible:border-accent"
        @click="$emit('act')"
      >
        {{ props.action.label }}
      </button>
    </ToastAction>
    <ToastClose
      aria-label="Dismiss"
      class="ui:inline-flex ui:cursor-pointer ui:items-center ui:justify-center ui:rounded-control ui:border ui:border-transparent ui:bg-transparent ui:p-0 ui:text-muted ui:block-6 ui:inline-6 ui:hover:bg-surface-2 ui:hover:text-fg ui:focus-visible:border-accent"
    >
      <X class="ui:block-3.5 ui:inline-3.5" />
    </ToastClose>
  </ToastRoot>
</template>
