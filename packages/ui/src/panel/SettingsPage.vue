<!-- SettingsPage: the Settings editor in the main area of either page, as VS Code's: a tab with its close button, a search field over the list, User and Workspace tabs choosing the file a change is written to (a workspace value outranks the user's) and Open Settings (JSON) at their end; then a table of contents of the groups, a hairline between it and the list as VS Code draws it, beside every setting generated from settings.schema, each "Group: Title", its description and its control, a bar at its start where the chosen file sets it and a gear for Reset Setting and Copy Setting ID. The JSON view edits the chosen file itself (SettingsJson). -->
<script setup lang="ts">
import { FileJson, Search, Settings, X } from "@lucide/vue";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";

import IconButton from "../primitives/icon-button/IconButton.vue";
import type { Scope } from "../store/settings";
import { useSettingsStore } from "../store/settings";
import { useUiStore } from "../store/ui";
import { groupsOf } from "./settingsFields";
import SqlEngineRow from "./SqlEngineRow.vue";
import SettingsItem from "./SettingsItem.vue";
import SettingsJson from "./SettingsJson.vue";
import ScopeTabs from "./ScopeTabs.vue";
import { matching } from "./settingsFields";

const props = defineProps<{ off: boolean }>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();

const settings = useSettingsStore();
const scope = ref<Scope>("user");
const query = ref("");
const ui = useUiStore();
const json = computed({
  get: () => ui.pageJson,
  set: (value: boolean) => {
    ui.pageJson = value;
  },
});
// Side effect: leaving the page (a reload, a notebook opened, the tab closed) with unsaved Settings (JSON) text asks the
// browser's own question; closing Settings and Go to Home ask ours (commands/app.ts askSettingsFirst)
const guard = (event: BeforeUnloadEvent): void => {
  if (ui.settingsUnsavedScopes().length > 0) event.preventDefault();
};
onMounted(() => {
  window.addEventListener("beforeunload", guard);
});
onBeforeUnmount(() => {
  window.removeEventListener("beforeunload", guard);
});
const groups = computed(() => matching(groupsOf(settings.schema), query.value));
const found = computed(() => groups.value.reduce((sum, group) => sum + group.fields.length, 0));
const list = ref<HTMLElement | null>(null);
const current = ref<string | null>(null);

const groupId = (name: string) => `settings-group-${name.toLowerCase()}`;
function reveal(name: string): void {
  current.value = name;
  document.getElementById(groupId(name))?.scrollIntoView({ block: "start" });
}
/** The group whose heading is nearest the list's top, for the table of contents. */
function track(): void {
  const top = list.value?.getBoundingClientRect().top ?? 0;
  const seen = groups.value.findLast(
    (group) =>
      (document.getElementById(groupId(group.name))?.getBoundingClientRect().top ?? 0) <= top + 8,
  );
  current.value = seen?.name ?? groups.value[0]?.name ?? null;
}
/** "Modified in: Workspace": that tab, the same setting kept where it was in the list (only the list scrolls). */
async function showIn(next: Scope, key: string): Promise<void> {
  const item = () => list.value?.querySelector(`[data-setting="${key}"]`);
  const before = item()?.getBoundingClientRect().top;
  scope.value = next;
  await nextTick();
  const after = item()?.getBoundingClientRect().top;
  if (list.value && before !== undefined && after !== undefined)
    list.value.scrollTop += after - before;
}
</script>

<template>
  <section aria-label="Settings" class="ui:flex ui:flex-col ui:bg-bg ui:block-full ui:min-block-0">
    <div
      class="ui:flex ui:shrink-0 ui:items-stretch ui:border-be ui:border-border ui:bg-side ui:block-8.5"
    >
      <div
        class="ui:flex ui:items-center ui:gap-2 ui:border-e ui:border-border ui:bg-bg ui:ps-3 ui:pe-1 ui:text-small ui:text-fg"
      >
        <Settings class="ui:shrink-0 ui:text-muted ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
        Settings
        <IconButton
          label="Close Settings"
          data-testid="settings-close"
          @click="emit('command', 'ui.page.close')"
        >
          <X class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
        </IconButton>
      </div>
    </div>
    <div
      class="ui:mx-auto ui:flex ui:flex-1 ui:flex-col ui:px-6 ui:pbs-4 ui:inline-full ui:max-inline-[64rem] ui:min-block-0"
    >
      <label v-if="!json" class="ui:relative ui:flex ui:items-center">
        <Search
          class="ui:pointer-events-none ui:absolute ui:inset-s-2.5 ui:text-muted ui:block-3.5 ui:inline-3.5"
          aria-hidden="true"
        />
        <input
          v-model="query"
          type="search"
          aria-label="Search settings"
          placeholder="Search settings"
          data-testid="settings-search"
          class="ui:rounded-control ui:border ui:border-border ui:bg-bg ui:ps-8 ui:pe-28 ui:font-inherit ui:text-ui ui:text-fg ui:block-8 ui:inline-full ui:focus-visible:border-accent"
        />
        <span
          v-if="query.trim() !== ''"
          class="ui:pointer-events-none ui:absolute ui:inset-e-3 ui:text-tiny ui:text-muted"
          >{{ found === 1 ? "1 setting found" : `${String(found)} settings found` }}</span
        >
      </label>
      <div
        class="ui:flex ui:items-end ui:justify-between ui:gap-4 ui:border-be ui:border-border ui:pbs-3"
      >
        <ScopeTabs v-model="scope" />
        <IconButton
          :label="json ? 'Open Settings (UI)' : 'Open Settings (JSON)'"
          data-testid="settings-json"
          class="ui:mbe-1"
          @click="json = !json"
        >
          <FileJson class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
        </IconButton>
      </div>
      <SettingsJson v-if="json" :key="scope" :scope="scope" :off="props.off" />
      <div v-else class="ui:flex ui:flex-1 ui:pbs-3 ui:min-block-0">
        <nav
          aria-label="Setting groups"
          class="ui:flex ui:shrink-0 ui:flex-col ui:overflow-y-auto ui:border-e ui:border-border ui:pe-3 ui:inline-40"
        >
          <button
            v-for="group in groups"
            :key="group.name"
            type="button"
            :aria-current="current === group.name ? 'true' : undefined"
            class="ui:cursor-pointer ui:rounded-small ui:border-0 ui:bg-transparent ui:px-2 ui:py-1 ui:text-start ui:font-inherit ui:text-small ui:text-fg-2 ui:hover:text-fg ui:aria-[current=true]:font-semibold ui:aria-[current=true]:text-fg"
            @click="reveal(group.name)"
          >
            {{ group.name
            }}<span v-if="query.trim() !== ''" class="ui:text-muted">
              ({{ group.fields.length }})</span
            >
          </button>
        </nav>
        <div
          ref="list"
          tabindex="-1"
          data-testid="settings-list"
          class="ui:flex ui:flex-1 ui:flex-col ui:overflow-y-auto ui:ps-8 ui:pbe-12 ui:min-inline-0"
          @scroll.passive="track"
        >
          <p v-if="groups.length === 0" class="ui:m-0 ui:py-4 ui:text-small ui:text-muted">
            No settings found
          </p>
          <section
            v-for="group in groups"
            :id="groupId(group.name)"
            :key="group.name"
            :aria-labelledby="`${groupId(group.name)}-title`"
            class="ui:flex ui:flex-col"
          >
            <h2
              :id="`${groupId(group.name)}-title`"
              class="ui:m-0 ui:pbs-3 ui:pbe-1 ui:text-[1.0625rem] ui:font-semibold ui:text-fg"
            >
              {{ group.name }}
            </h2>
            <SettingsItem
              v-for="field in group.fields"
              :key="field.key"
              :group="group.name"
              :field="field"
              :scope="scope"
              :off="props.off"
              @scope="(next) => showIn(next, field.key)"
            />
            <SqlEngineRow v-if="group.name === 'Query'" :off="props.off" />
          </section>
        </div>
      </div>
    </div>
  </section>
</template>
