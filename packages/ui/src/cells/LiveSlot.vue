<!-- LiveSlot: where a client cell's real container goes: an element the host moves runtime-web's node into once mounted and back to the park before it goes (unless another slot took it meanwhile, as when a run's own slot hands it to the DOM output), so a Vue re-render never recreates, clones or styles it. It sits inside output-view's [data-live] slot, which stops every inherited property. -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps<{
  slotInto: (into: HTMLElement) => boolean;
  release: (from: HTMLElement) => void;
}>();
const into = ref<HTMLElement | null>(null);
// Side effects: the container moves in on mount and back to the park on unmount (it outlives this view).
onMounted(() => {
  if (into.value !== null) props.slotInto(into.value);
});
onBeforeUnmount(() => {
  if (into.value !== null) props.release(into.value);
});
</script>

<template>
  <div ref="into" data-testid="live-slot" />
</template>
