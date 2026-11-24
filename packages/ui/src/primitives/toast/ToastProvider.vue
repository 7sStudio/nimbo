<!-- ToastProvider: the toasts' timing for its subtree, Reka's provider at 6 s, paused on hover and focus, swiped away to the end. -->
<script setup lang="ts">
import { ToastProvider } from "reka-ui";
</script>

<template>
  <ToastProvider :duration="6000" swipe-direction="right" label="Notification">
    <slot />
  </ToastProvider>
</template>
