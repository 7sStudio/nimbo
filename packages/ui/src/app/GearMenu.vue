<!-- GearMenu: the gear at the foot of the activity bar, as VS Code's Manage menu: the command palette, Settings, Keyboard Shortcuts and the theme. Every item dispatches a command id. -->
<script setup lang="ts">
import { Settings } from "@lucide/vue";
import { DropdownMenuTrigger } from "reka-ui";
import { computed } from "vue";

import { useDispatcher } from "../commands/dispatch";
import { keysFor } from "../keyboard/keymap";
import type { MenuItem } from "../overlays/menus";
import MenuItems from "../overlays/MenuItems.vue";
import DropdownMenu from "../primitives/dropdown-menu/DropdownMenu.vue";
import DropdownMenuContent from "../primitives/dropdown-menu/DropdownMenuContent.vue";

const props = defineProps<{
  /** The current ui.theme choice. */
  theme: string;
  mac: boolean;
}>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();
const dispatcher = useDispatcher();

type Item = Extract<MenuItem, { kind: "item" }>;
const entry = (label: string, command: string, args?: Record<string, unknown>): Item => {
  const keys = keysFor(command, args);
  return { kind: "item", label, command, ...(args ? { args } : {}), ...(keys ? { keys } : {}) };
};
const items = computed<readonly MenuItem[]>(() => [
  entry("Command Palette", "ui.palette.open"),
  { kind: "separator" },
  entry("Settings", "ui.settings.open"),
  entry("Keyboard Shortcuts", "ui.shortcuts.open"),
  {
    kind: "sub",
    label: "Theme",
    items: (["system", "light", "dark"] as const).map((theme) => ({
      ...entry(theme.charAt(0).toUpperCase() + theme.slice(1), "ui.theme.set", { theme }),
      ...(props.theme === theme ? { current: true } : {}),
    })),
  },
]);
const available = (item: Item) => dispatcher.available(item.command, item.args);
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger
      data-rail="settings"
      aria-label="Manage"
      title="Manage"
      class="ui:inline-flex ui:shrink-0 ui:cursor-pointer ui:items-center ui:justify-center ui:rounded-control ui:border ui:border-transparent ui:bg-transparent ui:p-0 ui:text-muted ui:block-9 ui:inline-9 ui:hover:bg-well ui:hover:text-fg ui:focus-visible:border-accent ui:aria-pressed:text-fg ui:data-[state=open]:bg-well ui:data-[state=open]:text-fg"
    >
      <Settings class="ui:block-4.5 ui:inline-4.5" aria-hidden="true" />
    </DropdownMenuTrigger>
    <DropdownMenuContent data-overlay="menu" side="right" align="end" class="ui:min-inline-[14rem]">
      <MenuItems
        :items="items"
        :mac="props.mac"
        overlay="menu"
        :available="available"
        @choose="(item) => emit('command', item.command, item.args)"
      />
    </DropdownMenuContent>
  </DropdownMenu>
</template>
