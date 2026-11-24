<!-- DiffGear: the notebook diff's settings on a gear beside the toolbar, as GitNotebooks has them: Hide Outputs, Show Entire Notebook, Raw Markdown, Cells to Show Around Changes (0 to 3), Metadata Changes. Each is the user's setting (notebookDiff.*), so it holds for every diff. -->
<script setup lang="ts">
import { Settings2 } from "@lucide/vue";
import { DropdownMenuRadioGroup, DropdownMenuTrigger } from "reka-ui";
import { computed } from "vue";

import DropdownMenu from "../primitives/dropdown-menu/DropdownMenu.vue";
import DropdownMenuCheckboxItem from "../primitives/dropdown-menu/DropdownMenuCheckboxItem.vue";
import DropdownMenuContent from "../primitives/dropdown-menu/DropdownMenuContent.vue";
import DropdownMenuLabel from "../primitives/dropdown-menu/DropdownMenuLabel.vue";
import DropdownMenuRadioItem from "../primitives/dropdown-menu/DropdownMenuRadioItem.vue";
import DropdownMenuSeparator from "../primitives/dropdown-menu/DropdownMenuSeparator.vue";
import type { SettingsKey } from "@jsnb/core";
import { useSettingsStore } from "../store/settings";

const settings = useSettingsStore();
const flag = (key: SettingsKey) => settings.valueOf(key) === true;
const set = (key: SettingsKey, value: unknown) => void settings.set(key, value, "user");
const toggles = [
  { key: "notebookDiff.hideOutputs", label: "Hide Outputs" },
  { key: "notebookDiff.showEntireNotebook", label: "Show Entire Notebook" },
  { key: "notebookDiff.rawMarkdown", label: "Raw Markdown" },
  { key: "notebookDiff.showMetadata", label: "Metadata Changes" },
] as const;
const context = computed({
  get: () => {
    const value = settings.valueOf("notebookDiff.contextCells");
    return typeof value === "number" ? String(value) : "1";
  },
  set: (value: string) => {
    set("notebookDiff.contextCells", Number(value));
  },
});
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger
      aria-label="Diff Settings"
      title="Diff Settings"
      data-testid="diff-gear"
      class="ui:inline-flex ui:cursor-pointer ui:items-center ui:justify-center ui:rounded-control ui:border ui:border-transparent ui:bg-transparent ui:p-0 ui:text-muted ui:block-6 ui:inline-6 ui:hover:bg-well ui:hover:text-fg ui:focus-visible:border-accent ui:data-[state=open]:bg-well ui:data-[state=open]:text-fg"
    >
      <Settings2 class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
    </DropdownMenuTrigger>
    <DropdownMenuContent data-overlay="menu" align="end" class="ui:min-inline-[15rem]">
      <DropdownMenuCheckboxItem
        v-for="toggle in toggles"
        :key="toggle.key"
        :model-value="flag(toggle.key)"
        @update:model-value="(on: boolean) => set(toggle.key, on)"
        @select.prevent
      >
        {{ toggle.label }}
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Cells to Show Around Changes</DropdownMenuLabel>
      <DropdownMenuRadioGroup v-model="context">
        <DropdownMenuRadioItem
          v-for="count in ['0', '1', '2', '3']"
          :key="count"
          :value="count"
          @select.prevent
        >
          {{ count }}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
