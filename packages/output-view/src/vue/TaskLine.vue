<!-- The line under the header that shows the viewer's long work (loading more, downloading, exporting the full value)
with its Cancel, what was cancelled, and what failed, as an alert; both can be dismissed (08 §5: nothing is
swallowed). -->
<script setup lang="ts">
import type { Tasks } from "./useTasks.js";
import TextButton from "./TextButton.vue";

defineProps<{ readonly tasks: Tasks }>();
</script>

<template>
  <p v-if="tasks.running.value" data-part="task" role="status">
    {{ tasks.running.value.label }}…
    <TextButton @click="tasks.cancel()">Cancel</TextButton>
  </p>
  <p v-if="tasks.notice.value" data-part="task" role="status">
    {{ tasks.notice.value }}
    <TextButton @click="tasks.dismiss('notice')">Dismiss</TextButton>
  </p>
  <p v-if="tasks.failure.value" data-part="task-error" role="alert">
    {{ tasks.failure.value }}
    <TextButton @click="tasks.dismiss('failure')">Dismiss</TextButton>
  </p>
</template>
