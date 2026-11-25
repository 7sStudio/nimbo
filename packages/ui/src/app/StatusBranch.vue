<!-- StatusBranch: the status bar's branch, as VS Code's: the branch icon and name, `*` while the tree has changes (a click opens Checkout to…); beside it the sync item, its counts behind and ahead of the upstream (a click syncs), Publish Branch's cloud for a branch without upstream, and a turning icon with git's progress while a fetch, pull or push runs. Shown only inside a git repository. -->
<script setup lang="ts">
import { CloudUpload, GitBranch, RefreshCw } from "@lucide/vue";
import { computed } from "vue";

import { useGitStore } from "../store/git";

const props = defineProps<{ branch: string; command: string; args: Record<string, unknown> }>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();
const git = useGitStore();
const at = computed(() => git.repo?.branch);
const counts = computed(() => {
  const branch = at.value;
  if (branch?.upstream == null) return "";
  return `${String(branch.behind)}↓ ${String(branch.ahead)}↑`;
});
const publish = computed(
  () => at.value?.name != null && at.value.oid !== null && at.value.upstream === null,
);
const item =
  "ui:inline-flex ui:cursor-pointer ui:items-center ui:gap-1 ui:rounded-control ui:border ui:border-transparent ui:bg-transparent ui:px-1 ui:font-medium ui:text-fg-2 ui:block-5.5 ui:hover:bg-well ui:hover:text-fg ui:focus-visible:border-accent";
</script>

<template>
  <button
    type="button"
    data-testid="status-branch"
    :title="`${props.branch.replace(/\*$/u, '')} (Git), Checkout Branch/Tag…`"
    :class="item"
    @click="emit('command', props.command, props.args)"
  >
    <GitBranch class="ui:block-3 ui:inline-3" aria-hidden="true" />
    {{ props.branch }}
  </button>
  <span
    v-if="git.running !== null"
    data-testid="status-sync"
    :title="git.progress === '' ? `${git.running}…` : git.progress"
    :class="item"
  >
    <RefreshCw class="ui:motion-safe:animate-spin ui:block-3 ui:inline-3" aria-hidden="true" />
  </span>
  <button
    v-else-if="publish"
    type="button"
    data-testid="status-sync"
    title="Publish Branch"
    :class="item"
    @click="emit('command', 'ui.git.publish')"
  >
    <CloudUpload class="ui:block-3 ui:inline-3" aria-hidden="true" />
  </button>
  <button
    v-else-if="counts !== ''"
    type="button"
    data-testid="status-sync"
    :title="`${at?.upstream ?? ''}: Synchronize Changes`"
    :class="item"
    @click="emit('command', 'ui.git.sync')"
  >
    <RefreshCw class="ui:block-3 ui:inline-3" aria-hidden="true" />
    <span class="ui:tabular-nums">{{ counts }}</span>
  </button>
</template>
