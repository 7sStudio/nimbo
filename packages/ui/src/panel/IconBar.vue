<!-- IconBar: the activity bar, as VS Code's: bare icons on the left edge, each naming its view in a tooltip. Explorer (outline and files), Search, Source Control (with the count of changed files, shown only inside a git repository), Environment (packages and secrets), Agent (with the count of edits to review); the Manage gear at the foot (palette, Settings, Keyboard Shortcuts, theme). Each opens its view in the side panel; the active one takes the panel's tone, and a click on it hides the panel. While the panel is hidden the numbers under Cells jump straight to a cell, the dark one being where you are. -->
<script setup lang="ts">
import type { CellId } from "@jsnb/core";
import { Bot, BugPlay, GitBranch, List, Package, Search } from "@lucide/vue";

import { computed } from "vue";

import GearMenu from "../app/GearMenu.vue";

import { keysShown } from "../keyboard/keymap";
import IconButton from "../primitives/icon-button/IconButton.vue";
import type { SideView } from "../store/layout";

const props = defineProps<{
  /** The view the open side panel shows, or null while it is hidden. */
  open: SideView | null;
  /** The view the side panel shows or last showed: its icon is the one that shows the panel again. */
  last: SideView;
  /** Cells an agent edited last. */
  agentEdits: number;
  /** Changed files, or null outside a repository (or with git.enabled off): the Source Control icon is not shown. */
  changes: number | null;
  /** The cells, for the jump list shown while the panel is hidden. */
  cells: readonly { readonly id: CellId; readonly number: number; readonly selected: boolean }[];
  /** The ui.theme choice, for the gear's Theme menu. */
  theme: string;
  mac: boolean;
}>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();

const views = [
  { id: "explorer", title: "Explorer", hint: "outline and files", icon: List },
  { id: "search", title: "Search", hint: "across the cells and file names", icon: Search },
  { id: "sourceControl", title: "Source Control", hint: "changed files", icon: GitBranch },
  { id: "environment", title: "Environment", hint: "packages and secrets", icon: Package },
  { id: "agent", title: "Agent", hint: "cells an agent edited", icon: Bot },
  {
    id: "debug",
    title: "Run and Debug",
    hint: "breakpoints, call stack, variables",
    icon: BugPlay,
  },
] as const;
const icon = "ui:block-4.5 ui:inline-4.5";
/** The number on a view's icon: the edits to review, the changed files; 0 shows none. */
const countOf = (id: string): number =>
  id === "agent" ? props.agentEdits : id === "sourceControl" ? (props.changes ?? 0) : 0;
const label = (view: (typeof views)[number]) => {
  const count = countOf(view.id);
  if (count === 0) return `${view.title}, ${view.hint}`;
  return view.id === "agent"
    ? `${view.title}, ${String(count)} to review`
    : `${view.title}, ${String(count)} changed`;
};
const shown = computed(() =>
  views.filter((view) => view.id !== "sourceControl" || props.changes !== null),
);
</script>

<template>
  <nav
    aria-label="Views"
    data-keys="own"
    class="ui:flex ui:flex-col ui:items-center ui:gap-1 ui:pbs-1 ui:pbe-2 ui:block-full"
  >
    <span v-for="view in shown" :key="view.id" :data-rail="view.id" class="ui:relative ui:flex">
      <IconButton
        size="rail"
        side="right"
        :label="label(view)"
        :data-switch="view.id === props.last ? 'side' : undefined"
        :keys="props.open === view.id ? keysShown('ui.panel.toggle', props.mac) : undefined"
        :pressed="props.open === view.id"
        @click="emit('command', 'ui.panel.toggle', { which: view.id })"
      >
        <component :is="view.icon" :class="icon" aria-hidden="true" />
      </IconButton>
      <span
        v-if="countOf(view.id) > 0"
        aria-hidden="true"
        :data-testid="view.id === 'agent' ? 'agent-count' : 'scm-count'"
        :class="[
          'ui:pointer-events-none ui:absolute ui:end-0.5 ui:inset-bs-0 ui:font-mono ui:text-[0.5625rem] ui:font-medium',
          view.id === 'agent' ? 'ui:text-agent' : 'ui:text-accent-text',
        ]"
        >{{ countOf(view.id) }}</span
      >
    </span>
    <template v-if="props.open === null && props.cells.length > 0">
      <span id="jump-title" class="ui:mbs-3 ui:text-[0.625rem] ui:text-muted">Cells</span>
      <ol
        aria-labelledby="jump-title"
        class="ui:m-0 ui:flex ui:list-none ui:flex-col ui:items-center ui:gap-0.5 ui:overflow-y-auto ui:p-0 ui:min-block-0"
      >
        <li v-for="cell in props.cells" :key="cell.id">
          <button
            type="button"
            :aria-label="`Go to cell ${String(cell.number)}`"
            :aria-current="cell.selected ? 'true' : undefined"
            class="ui:cursor-pointer ui:rounded-control ui:border ui:border-transparent ui:bg-transparent ui:font-mono ui:text-tiny ui:font-medium ui:text-fg-2 ui:block-5.5 ui:inline-5.5 ui:hover:bg-well ui:focus-visible:border-accent ui:aria-[current]:bg-chip ui:aria-[current]:text-chip-fg"
            @click="emit('command', 'ui.select', { cell: cell.id })"
          >
            {{ cell.number }}
          </button>
        </li>
      </ol>
    </template>
    <span class="ui:flex-1" />
    <GearMenu
      :theme="props.theme"
      :mac="props.mac"
      @command="(id, args) => emit('command', id, args)"
    />
  </nav>
</template>
