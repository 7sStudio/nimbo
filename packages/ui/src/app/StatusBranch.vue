<!-- StatusBranch: the status bar's branch, as VS Code's: the branch icon and name, `*` while the tree has changes; a click opens the Source Control view. Shown only inside a git repository. -->
<script setup lang="ts">
import { GitBranch } from "@lucide/vue";

const props = defineProps<{ branch: string; command: string; args: Record<string, unknown> }>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();
</script>

<template>
  <button
    type="button"
    data-testid="status-branch"
    :title="`${props.branch.replace(/\*$/u, '')} (Git), Source Control`"
    class="ui:inline-flex ui:cursor-pointer ui:items-center ui:gap-1 ui:rounded-control ui:border ui:border-transparent ui:bg-transparent ui:px-1 ui:font-medium ui:text-fg-2 ui:block-5.5 ui:hover:bg-well ui:hover:text-fg ui:focus-visible:border-accent"
    @click="emit('command', props.command, props.args)"
  >
    <GitBranch class="ui:block-3 ui:inline-3" aria-hidden="true" />
    {{ props.branch }}
  </button>
</template>
