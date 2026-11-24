<!-- Toasts: the page's notices at the bottom right: at most three, 6 s each, paused while the pointer or focus rests on one; a toast's action is a command id (Undo → undo.restore). Each is a status. The wrapper is aria-live="off" for the same reason as the viewport: Reka renders each toast's announcement here, and a modal dialog must not hide it. -->
<script setup lang="ts">
import type { Toast as ToastModel } from "../store/toasts";
import Toast from "../primitives/toast/Toast.vue";
import ToastProvider from "../primitives/toast/ToastProvider.vue";
import ToastViewport from "../primitives/toast/ToastViewport.vue";

const props = defineProps<{ toasts: readonly ToastModel[] }>();
const emit = defineEmits<{
  command: [id: string, args?: Record<string, unknown>];
  dismiss: [id: number];
  pause: [id: number];
  resume: [id: number];
}>();

function act(toast: ToastModel): void {
  if (toast.action === undefined) return;
  emit("command", toast.action.command, toast.action.args);
  emit("dismiss", toast.id);
}
</script>

<template>
  <div aria-live="off" class="ui:contents">
    <ToastProvider>
      <Toast
        v-for="toast in props.toasts"
        :key="toast.id"
        :data-kind="toast.kind"
        :title="toast.title"
        :description="toast.text"
        :action="toast.action && { label: toast.action.label, alt: toast.action.label }"
        @update:open="(open: boolean) => open || emit('dismiss', toast.id)"
        @pause="emit('pause', toast.id)"
        @resume="emit('resume', toast.id)"
        @act="act(toast)"
      />
      <ToastViewport />
    </ToastProvider>
  </div>
</template>
