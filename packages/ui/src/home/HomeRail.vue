<!-- HomeRail: Home's activity bar, as VS Code's: the Explorer icon and, inside a git repository, Source Control with its count of changed files (a click shows the view, or hides the panel when it shows it), the Tutorial (its page in the main area, as JetBrains' Welcome screen has Learn) and the Manage gear at the foot. -->
<script setup lang="ts">
import { Files, GitBranch, GraduationCap } from "@lucide/vue";
import { computed } from "vue";

import GearMenu from "../app/GearMenu.vue";
import { keysFor, keyWords } from "../keyboard/keymap";
import IconButton from "../primitives/icon-button/IconButton.vue";

const props = defineProps<{
  /** The view the open side panel shows, or null while it is hidden. */
  open: "explorer" | "sourceControl" | null;
  /** Changed files, or null outside a repository: the Source Control icon is not shown. */
  changes: number | null;
  /** Whether the Tutorial's page shows; null when its icon is not shown. */
  tutorial: boolean | null;
  theme: string;
  mac: boolean;
}>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();
const keys = computed(() => {
  const bound = keysFor("ui.home.side.toggle");
  return bound === undefined ? undefined : keyWords(bound, props.mac);
});
</script>

<template>
  <nav
    aria-label="Views"
    class="ui:flex ui:flex-col ui:items-center ui:gap-1 ui:pbs-1 ui:pbe-2 ui:block-full"
  >
    <IconButton
      size="rail"
      side="right"
      label="Explorer"
      :keys="keys"
      :pressed="props.open === 'explorer'"
      data-switch="side"
      data-rail="explorer"
      @click="emit('command', 'ui.home.view.toggle', { view: 'explorer' })"
    >
      <Files class="ui:block-4.5 ui:inline-4.5" aria-hidden="true" />
    </IconButton>
    <span v-if="props.changes !== null" data-rail="sourceControl" class="ui:relative ui:flex">
      <IconButton
        size="rail"
        side="right"
        :label="
          props.changes > 0 ? `Source Control, ${String(props.changes)} changed` : 'Source Control'
        "
        :pressed="props.open === 'sourceControl'"
        @click="emit('command', 'ui.home.view.toggle', { view: 'sourceControl' })"
      >
        <GitBranch class="ui:block-4.5 ui:inline-4.5" aria-hidden="true" />
      </IconButton>
      <span
        v-if="props.changes > 0"
        aria-hidden="true"
        data-testid="scm-count"
        class="ui:pointer-events-none ui:absolute ui:end-0.5 ui:inset-bs-0 ui:font-mono ui:text-[0.5625rem] ui:font-medium ui:text-accent-text"
        >{{ props.changes }}</span
      >
    </span>
    <IconButton
      v-if="props.tutorial !== null"
      size="rail"
      side="right"
      label="Tutorial"
      :pressed="props.tutorial"
      data-rail="tutorial"
      @click="emit('command', props.tutorial ? 'ui.page.close' : 'ui.home.tutorial.show')"
    >
      <GraduationCap class="ui:block-4.5 ui:inline-4.5" aria-hidden="true" />
    </IconButton>
    <span class="ui:flex-1" />
    <GearMenu
      :theme="props.theme"
      :mac="props.mac"
      @command="(id, args) => emit('command', id, args)"
    />
  </nav>
</template>
