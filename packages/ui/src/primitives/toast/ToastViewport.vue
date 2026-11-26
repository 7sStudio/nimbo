<!-- ToastViewport: the stack at the bottom right (inline end), above everything but nothing else of ours (--z-toast), in the page's .jsnb-ui root. aria-live="off" keeps the stack in the accessibility tree while a modal dialog hides the rest of the page (Reka's hideOthers spares [aria-live] elements), so a toast a dialog raises (Copy path) is still a status; the toasts inside announce themselves. -->
<script setup lang="ts">
import { ToastPortal, ToastViewport } from "reka-ui";

import { overlayHost } from "../overlay";
</script>

<template>
  <ToastPortal :to="overlayHost">
    <ToastViewport
      data-slot="toast-viewport"
      aria-live="off"
      class="ui:fixed ui:inset-e-4 ui:inset-be-[calc(var(--footer)+0.75rem)] ui:z-(--z-toast) ui:m-0 ui:flex ui:list-none ui:flex-col ui:gap-2 ui:p-0 ui:max-inline-[min(90vw,24rem)]"
    />
  </ToastPortal>
</template>
