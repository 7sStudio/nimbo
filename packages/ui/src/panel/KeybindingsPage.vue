<!-- KeybindingsPage: Keyboard Shortcuts in the main area of either page, as VS Code's editor: a tab with its close button; a search over every binding with Record Keys (Alt K), Sort by Precedence and a count while filtering; rows by command title; User and Workspace tabs choosing the keybindings.json a change is written to, and Open Keyboard Shortcuts (JSON) at their end; the rules a file holds that cannot be applied; then the table (KeybindingsTable). Everything reads the live registry (keyboard/keymap.ts), so a save shows here and in every menu, tooltip and the palette at once. -->
<script setup lang="ts">
import { ArrowDownWideNarrow, FileJson, Keyboard, Search, X } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";

import { useDispatcher } from "../commands/dispatch";
import { keymapTitles, labelOf, registryTitles } from "../commands/labels";
import { filterRows, keyRows } from "../keyboard/keybindingRows";
import { documented, keyFiles, keyWords, resolvedKeys } from "../keyboard/keymap";
import { isMac } from "../keyboard/modes";
import { paletteCatalogue } from "../overlays/palette";
import IconButton from "../primitives/icon-button/IconButton.vue";
import type { Scope } from "../store/settings";
import { useUiStore } from "../store/ui";
import { keybindingSearch } from "./keybindingSearch";
import KeybindingsTable from "./KeybindingsTable.vue";
import SettingsJson from "./SettingsJson.vue";
import ScopeTabs from "./ScopeTabs.vue";

const props = defineProps<{ off: boolean }>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();

const dispatcher = useDispatcher();
const ui = useUiStore();
const mac = isMac(navigator.userAgent);
const scope = ref<Scope>("user");
/** Sort by Precedence: the bindings in the order they apply instead of by title, as VS Code's toggle. */
const precedence = ref(false);
const field = ref<HTMLInputElement | null>(null);
const table = ref<InstanceType<typeof KeybindingsTable> | null>(null);
const search = keybindingSearch(mac, () => field.value?.focus());
const { query, recording } = search;

const titleOf = (command: string, args?: Record<string, unknown>) =>
  labelOf(
    command,
    args,
    (id) => keymapTitles[id] ?? registryTitles[id] ?? dispatcher.find(id)?.title ?? id,
  );
const catalogue = paletteCatalogue(dispatcher.commands);
const rows = computed(() =>
  keyRows(
    {
      entries: resolvedKeys.value.entries,
      files: keyFiles.value,
      catalogue,
      documented,
      titleOf,
    },
    precedence.value,
  ),
);
const shown = computed(() => filterRows(rows.value, query.value, mac));
const problems = computed(() =>
  resolvedKeys.value.problems.map(
    (each) => `${each.file} rule ${String(each.index + 1)}: ${each.message}`,
  ),
);
// the search has the focus when the editor opens, as VS Code's
onMounted(() => field.value?.focus());
function fieldKey(event: KeyboardEvent): void {
  if (search.key(event) || event.key !== "ArrowDown") return;
  event.preventDefault();
  table.value?.focusRow(0);
}
function showSame(keys: string): void {
  search.showKeys(keys);
  table.value?.focusRow(0);
}
</script>

<template>
  <section
    aria-label="Keyboard Shortcuts"
    class="ui:flex ui:flex-col ui:bg-bg ui:block-full ui:min-block-0"
  >
    <div class="ui:flex ui:shrink-0 ui:border-be ui:border-border ui:bg-side ui:block-8.5">
      <div
        class="ui:flex ui:items-center ui:gap-2 ui:border-e ui:border-border ui:bg-bg ui:ps-3 ui:pe-1 ui:text-small ui:text-fg"
      >
        <Keyboard class="ui:shrink-0 ui:text-muted ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
        Keyboard Shortcuts
        <IconButton
          label="Close Keyboard Shortcuts"
          data-testid="keybindings-close"
          @click="emit('command', 'ui.page.close')"
        >
          <X class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
        </IconButton>
      </div>
    </div>
    <div
      class="ui:mx-auto ui:flex ui:flex-1 ui:flex-col ui:px-6 ui:pbs-4 ui:inline-full ui:max-inline-[80rem] ui:min-block-0"
    >
      <label v-if="!ui.pageJson" class="ui:relative ui:flex ui:items-center">
        <Search
          class="ui:pointer-events-none ui:absolute ui:inset-s-2.5 ui:text-muted ui:block-3.5 ui:inline-3.5"
          aria-hidden="true"
        />
        <input
          ref="field"
          v-model="query"
          type="text"
          role="searchbox"
          aria-label="Search keybindings"
          :placeholder="
            recording ? 'Recording Keys. Press Alt K to stop' : 'Type to search in keybindings'
          "
          :data-keys="recording ? 'capture' : undefined"
          :readonly="recording"
          data-testid="keybindings-search"
          autocomplete="off"
          spellcheck="false"
          :class="[
            'ui:rounded-control ui:border ui:bg-bg ui:ps-8 ui:pe-44 ui:font-inherit ui:text-ui ui:text-fg ui:block-8 ui:inline-full ui:focus-visible:border-accent',
            recording ? 'ui:border-accent' : 'ui:border-border',
          ]"
          @keydown="fieldKey"
        />
        <span
          class="ui:absolute ui:inset-e-1 ui:flex ui:items-center ui:gap-1 ui:text-tiny ui:text-muted"
        >
          <span v-if="query.trim() !== ''" data-testid="keybindings-count" class="ui:pe-1">{{
            shown.length === 1 ? "1 result" : `${String(shown.length)} results`
          }}</span>
          <IconButton
            v-if="query !== ''"
            label="Clear Keybindings Search Input"
            @click="search.clear"
          >
            <X class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
          </IconButton>
          <IconButton
            label="Sort by Precedence (Highest First)"
            :pressed="precedence"
            data-testid="keybindings-precedence"
            :class="precedence ? 'ui:bg-well ui:text-fg' : ''"
            @click="precedence = !precedence"
          >
            <ArrowDownWideNarrow class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
          </IconButton>
          <IconButton
            label="Record Keys"
            :keys="keyWords('Alt+K', mac)"
            :pressed="recording"
            data-testid="keybindings-record"
            :class="recording ? 'ui:bg-well ui:text-fg' : ''"
            @click="search.toggle"
          >
            <Keyboard class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
          </IconButton>
        </span>
      </label>
      <div
        class="ui:flex ui:items-end ui:justify-between ui:gap-4 ui:border-be ui:border-border ui:pbs-3"
      >
        <ScopeTabs v-model="scope" />
        <IconButton
          :label="ui.pageJson ? 'Open Keyboard Shortcuts' : 'Open Keyboard Shortcuts (JSON)'"
          data-testid="keybindings-json"
          class="ui:mbe-1"
          @click="ui.pageJson = !ui.pageJson"
        >
          <FileJson class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
        </IconButton>
      </div>
      <SettingsJson
        v-if="ui.pageJson"
        :key="scope"
        kind="keybindings"
        :scope="scope"
        :off="props.off"
      />
      <template v-else>
        <p
          v-for="problem in problems"
          :key="problem"
          role="status"
          class="ui:m-0 ui:pbs-2 ui:text-small ui:text-warn-text"
        >
          {{ problem }}
        </p>
        <KeybindingsTable
          ref="table"
          :rows="shown"
          :entries="resolvedKeys.entries"
          :scope="scope"
          :off="props.off"
          :mac="mac"
          @same="showSame"
          @leave="field?.focus()"
        />
      </template>
    </div>
  </section>
</template>
