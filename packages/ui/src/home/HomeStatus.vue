<!-- HomeStatus: Home's status bar, as VS Code's: the git branch and its sync item inside a repository (a click on the branch opens Checkout to…), how many notebooks the list shows of the workspace's ("4 of 5 notebooks" while a folder or a search narrows it), how many kernels run, and the workspace folder's name (its path, the server's version and the daemon's pid in its tooltip). -->
<script setup lang="ts">
import { Folder } from "@lucide/vue";
import { computed } from "vue";

import { plural } from "../app/models";
import StatusBranch from "../app/StatusBranch.vue";

const props = defineProps<{
  root: string;
  notebooks: number;
  /** How many the list shows now. */
  shown: number;
  running: number;
  version: string;
  pid: number | null;
  loaded: boolean;
  /** The git branch, `main*` while dirty; null outside a repository. */
  branch?: string | null;
}>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();
const count = computed(() =>
  props.shown === props.notebooks
    ? plural(props.notebooks, "notebook")
    : `${String(props.shown)} of ${plural(props.notebooks, "notebook")}`,
);
const name = computed(
  () => props.root.split(/[\\/]/u).findLast((part) => part !== "") ?? props.root,
);
const title = computed(() =>
  [
    props.root,
    ...(props.version === "" ? [] : [`nimbo ${props.version}`]),
    ...(props.pid === null ? [] : [`daemon pid ${String(props.pid)}`]),
  ].join("\n"),
);
</script>

<template>
  <footer
    class="ui:flex ui:items-center ui:gap-4 ui:px-2.5 ui:text-tiny ui:whitespace-nowrap ui:text-muted ui:block-full ui:min-inline-0"
  >
    <StatusBranch
      v-if="props.branch != null"
      :branch="props.branch"
      command="ui.git.checkout"
      :args="{}"
      @command="(id, args) => emit('command', id, args)"
    />
    <span v-if="props.loaded" data-testid="summary">{{ count }}</span>
    <span v-if="props.loaded && props.running > 0" data-testid="running-count">{{
      `${plural(props.running, "kernel")} running`
    }}</span>
    <span
      class="ui:flex ui:flex-1 ui:items-center ui:gap-1 ui:min-inline-0"
      data-testid="workspace-path"
      :title="title"
      ><Folder
        v-if="props.root !== ''"
        class="ui:shrink-0 ui:block-3 ui:inline-3"
        aria-hidden="true"
      /><span class="ui:ellipsis ui:min-inline-0">{{ name }}</span></span
    >
  </footer>
</template>
