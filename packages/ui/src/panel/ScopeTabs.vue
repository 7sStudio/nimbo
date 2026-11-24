<!-- ScopeTabs: the User and Workspace tabs of Settings and Keyboard Shortcuts, choosing the file a change is written to, as VS Code's. -->
<script setup lang="ts">
import type { Scope } from "../store/settings";

const scope = defineModel<Scope>({ required: true });
const tab = (on: boolean) => [
  "ui:cursor-pointer ui:border-0 ui:border-be-2 ui:border-solid ui:bg-transparent ui:px-0 ui:pbe-1.5 ui:font-inherit ui:text-small",
  on ? "ui:border-fg ui:text-fg" : "ui:border-transparent ui:text-muted ui:hover:text-fg",
];
</script>

<template>
  <div role="tablist" aria-label="Scope" class="ui:flex ui:gap-5">
    <button
      v-for="each in ['user', 'workspace'] as const"
      :key="each"
      type="button"
      role="tab"
      :aria-selected="scope === each"
      :data-scope="each"
      :class="tab(scope === each)"
      @click="scope = each"
    >
      {{ each === "user" ? "User" : "Workspace" }}
    </button>
  </div>
</template>
