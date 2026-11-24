<!-- InstallPrompt: under a run that ended with MissingPackage (03-api §4.3.1), the packages it found missing and one Install button per name; the install goes through packages.add and the shell's installing banner shows its progress. There is no silent install: the user clicks. A name installed since (here or by an agent) leaves the list; once none is left, the line says to run the cell again. -->
<script setup lang="ts">
import { Download } from "@lucide/vue";
import { computed } from "vue";

import Button from "../primitives/button/Button.vue";
import { useWorkspaceStore } from "../store/workspace";

const props = defineProps<{ names: readonly string[]; off: boolean }>();
const emit = defineEmits<{ install: [names: readonly string[]] }>();
const workspace = useWorkspaceStore();
/** The last install of one of these names that failed: its error stays here, where Install was clicked. */
const failed = computed(() => {
  const failure = workspace.failure;
  return failure?.action === "add" && failure.names.some((name) => props.names.includes(name))
    ? failure
    : null;
});
const missing = computed(() => {
  const installed = new Set(workspace.packages.map((each) => each.name));
  return props.names.filter((name) => !installed.has(name));
});
</script>

<template>
  <div
    data-part="install"
    class="ui:flex ui:flex-wrap ui:items-center ui:gap-2 ui:bg-result ui:py-2 ui:ps-(--cell-inset) ui:pe-4 ui:text-ui ui:text-fg-2"
  >
    <template v-if="missing.length > 0">
      <span>Not installed in this workspace:</span>
      <!-- one install at a time: the buttons wait while one runs (the shell's banner shows it) -->
      <Button
        v-for="name in missing"
        :key="name"
        size="sm"
        :disabled="props.off || workspace.installing !== null"
        @click="emit('install', [name])"
      >
        <Download class="ui:block-[1cap] ui:inline-[1cap]" aria-hidden="true" />Install
        {{ name }}
      </Button>
    </template>
    <span v-else role="status">Installed: run the cell again.</span>
    <p
      v-if="failed !== null && workspace.installing === null"
      role="alert"
      class="ui:m-0 ui:basis-full ui:font-mono ui:text-tiny ui:wrap-anywhere ui:text-err-text"
    >
      {{ failed.error }}
    </p>
  </div>
</template>
