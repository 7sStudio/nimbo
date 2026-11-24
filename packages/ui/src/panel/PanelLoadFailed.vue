<!-- PanelLoadFailed: a view whose body could not load (its chunk is missing, as after a daemon upgraded under the open page): its title stays, and one line says to reload. -->
<script setup lang="ts">
import ViewHead from "./ViewHead.vue";
</script>

<template>
  <ViewHead id="side-title" title="Not loaded" region="side" />
  <p role="alert" class="ui:m-0 ui:px-1 ui:text-ui ui:text-fg-2">
    This view could not load. Reload the page to get it back.
  </p>
</template>
