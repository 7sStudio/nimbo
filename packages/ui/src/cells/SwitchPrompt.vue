<!-- SwitchPrompt: in the error block of a server run that ended with DefinedInClient (05-bridge §7), in the message's place, so the advice is said once: the client cell that defines the name, a "Switch this cell to client" button (Enter in command mode does the same), and the other way, moving the name to a server cell and exporting it. Its hook is data-testid="switch-to-client". -->
<script setup lang="ts">
import Button from "../primitives/button/Button.vue";

const props = defineProps<{ name: string; index: number; off: boolean }>();
const emit = defineEmits<{ switch: [] }>();
</script>

<template>
  <div
    data-part="switch"
    class="ui:flex ui:flex-wrap ui:items-center ui:gap-2 ui:text-code ui:text-fg"
  >
    <span
      ><code class="ui:font-mono">{{ props.name }}</code> lives in the page, in client cell
      {{ props.index }}.</span
    >
    <Button size="sm" data-testid="switch-to-client" :disabled="props.off" @click="emit('switch')"
      >Switch this cell to client</Button
    >
    <span class="ui:text-fg-2">Or move it to a server cell and export it.</span>
  </div>
</template>
