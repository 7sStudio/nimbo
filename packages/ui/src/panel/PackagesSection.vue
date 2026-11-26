<!-- PackagesSection: the workspace's packages, "none yet" or how many are installed beside the title. Add opens a field that installs what is typed (names separated by spaces) and, while one name is typed, searches the npm registry for it (packages.search, a short pause after the last key): each result has its version, weekly downloads and description, as plain text, and Add; a path, a version or several names are an install and never searched; a failed search says why in one quiet line; the package manager's progress lines show while an install or a removal runs, and a failed one's error stays until dismissed or the next run; the names the cells' last runs found missing each have Install; then the rows name, version and Remove, shown while the row is hovered or holds the keyboard's focus. The line under them says which package manager installs (the one the lockfile names, unless the setting picks one), and that installs are explicit, never silent. -->
<script setup lang="ts">
import { isPackageQuery } from "@jsnb/core";
import { Plus } from "@lucide/vue";
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";

import { runsOff } from "../app/useShell";
import { useDispatcher } from "../commands/dispatch";
import Button from "../primitives/button/Button.vue";
import Kbd from "../primitives/kbd/Kbd.vue";
import TextInput from "../primitives/text-input/TextInput.vue";
import { useNotebookStore } from "../store/notebook";
import { useSettingsStore } from "../store/settings";
import type { SearchAnswer } from "../store/workspace";
import { shownName as shown, useWorkspaceStore } from "../store/workspace";
import Section from "./Section.vue";
import { rowAction, rowEnd, wordButton } from "./rows";
import { whenStarted } from "./whenStarted";

const dispatcher = useDispatcher();
const workspace = useWorkspaceStore();
const notebook = useNotebookStore();
const form = ref(false);
const typed = ref("");
const names = computed(() => typed.value.split(/\s+/u).filter((name) => name !== ""));
const installed = computed(() => new Set(workspace.packages.map((each) => each.name)));
/** Missing names not installed since (the cell has not run again yet). */
const missing = computed(() =>
  notebook.missingPackages.filter((name) => !installed.value.has(name)),
);
const busy = computed(() => workspace.installing !== null);
const settings = useSettingsStore();
const manager = computed(() => {
  const value = settings.valueOf("packages.manager");
  return typeof value === "string" ? value : "";
});
/** The package manager the setting names, after the title; nothing for auto (the lockfile's). */
const managerNote = computed(() =>
  manager.value === "" || manager.value === "auto" ? undefined : manager.value,
);

/** Nothing writes in a view-only or closed tab. */
const off = computed(() => runsOff(notebook));

/** The search of what is typed: its results, or why it failed; null when nothing is searched. */
const found = shallowRef<SearchAnswer | string | null>(null);
const searching = ref(false);
let pending: AbortController | undefined;
let pause: ReturnType<typeof setTimeout> | undefined;
/** One package name of two characters or more is a query; several names, a version, a path or a URL are an install,
 * never sent to the registry. */
const query = computed(() => {
  const text = typed.value.trim();
  return text.length >= 2 && !/\s/u.test(text) && isPackageQuery(text) ? text : null;
});
/** Stops the search under way: its answer is no one's any more. */
function stopSearch(): void {
  clearTimeout(pause);
  pending?.abort();
  pending = undefined;
}
// Side effect: a pause after the last key searches the registry for the one name typed; a newer search aborts it.
watch(query, (text) => {
  stopSearch();
  if (text === null) {
    found.value = null;
    searching.value = false;
    return;
  }
  pause = setTimeout(() => {
    const mine = new AbortController();
    pending = mine;
    searching.value = true;
    void workspace.search(text, 10, mine.signal).then((answer) => {
      if (mine.signal.aborted || answer === undefined) return;
      found.value = answer;
      searching.value = false;
    });
  }, 350);
});
onBeforeUnmount(stopSearch);
const results = computed(() =>
  typeof found.value === "object" && found.value !== null ? found.value.results : [],
);
const weekly = (count: number | undefined) =>
  count === undefined
    ? ""
    : count >= 1_000_000
      ? `${(count / 1_000_000).toFixed(1)}M/wk`
      : count >= 1000
        ? `${(count / 1000).toFixed(1)}k/wk`
        : `${String(count)}/wk`;
async function show(): Promise<void> {
  form.value = true;
  await nextTick();
  document.getElementById("package-names")?.focus();
}
/** Installs `list`; what was typed stays until the add went through, so a refused name can be corrected. */
async function install(list: readonly string[]): Promise<void> {
  const added = await dispatcher.request("ui.packages.install", { names: list });
  if (added !== undefined && list === names.value) {
    typed.value = "";
    form.value = false;
  }
}
/** A search result added: the field and its results go once it is installed. */
async function addResult(name: string): Promise<void> {
  const added = await dispatcher.request("ui.packages.install", { names: [name] });
  if (added !== undefined) {
    typed.value = "";
    form.value = false;
  }
}
// an agent's install since the last look is in the list
whenStarted(notebook, workspace.refreshPackages);
</script>

<template>
  <Section
    name="packages"
    title="Packages"
    :count="workspace.packages.length"
    :note="managerNote"
    :force-open="
      form || workspace.installing !== null || workspace.failure !== null || missing.length > 0
    "
  >
    <template #tools>
      <button
        type="button"
        aria-label="Add package"
        :class="[wordButton, 'ui:bg-sheet']"
        :disabled="off"
        @click="show"
      >
        <Plus class="ui:block-3 ui:inline-3" aria-hidden="true" />Add
      </button>
    </template>
    <form
      v-if="form"
      aria-label="Add packages"
      class="ui:mbe-1.5 ui:flex ui:flex-col ui:gap-1.25 ui:bg-head ui:px-1.75 ui:pbs-1.75 ui:pbe-2"
      @submit.prevent="install(names)"
      @keydown.esc.stop="form = false"
    >
      <label class="ui:flex ui:flex-col ui:gap-0.5 ui:font-semibold">
        New package
        <TextInput
          id="package-names"
          v-model="typed"
          placeholder="Search npm, or stripe zod@4"
          :aria-controls="results.length > 0 ? 'package-results' : undefined"
          class="ui:font-mono ui:font-normal"
          autocomplete="off"
          spellcheck="false"
        />
      </label>
      <div class="ui:mbs-0.5 ui:flex ui:items-center ui:gap-1.5">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          :disabled="names.length === 0 || busy || off"
          >Install<Kbd class="ui:text-current ui:opacity-75">Enter</Kbd></Button
        >
        <Button type="button" size="sm" @click="form = false">Cancel<Kbd>Esc</Kbd></Button>
        <span v-if="searching" class="ui:text-tiny ui:text-muted" aria-live="polite"
          >Searching…</span
        >
      </div>
      <p
        v-if="typeof found === 'string'"
        class="ui:m-0 ui:text-tiny ui:wrap-anywhere ui:text-muted"
        data-testid="search-failure"
      >
        {{ found }}
      </p>
      <p
        v-else-if="found !== null && results.length === 0"
        class="ui:m-0 ui:text-tiny ui:text-muted"
      >
        No packages found
      </p>
      <ul
        v-if="results.length > 0"
        id="package-results"
        aria-label="Search results"
        class="ui:m-0 ui:-mx-1 ui:flex ui:list-none ui:flex-col ui:p-0"
        data-testid="search-results"
      >
        <li
          v-for="each in results"
          :key="each.name"
          class="ui:flex ui:flex-col ui:gap-0.25 ui:rounded-control ui:px-1 ui:py-1 ui:min-inline-0 ui:hover:bg-sheet ui:has-[:focus-visible]:bg-sheet"
          :data-result="each.name"
        >
          <p class="ui:m-0 ui:flex ui:items-center ui:gap-1.5 ui:min-inline-0">
            <span
              class="ui:flex-1 ui:ellipsis ui:font-mono ui:text-[0.71875rem] ui:font-semibold ui:text-fg ui:min-inline-0"
              :title="each.name"
              >{{ each.name }}</span
            >
            <button
              type="button"
              :aria-label="`Add ${each.name}`"
              :class="[wordButton, 'ui:bg-sheet']"
              :disabled="busy || off"
              @click="addResult(each.name)"
            >
              Add
            </button>
          </p>
          <p class="ui:m-0 ui:flex ui:items-center ui:gap-1.5 ui:text-tiny ui:text-muted">
            <span v-if="each.version !== undefined">{{ each.version }}</span>
            <span v-if="each.weeklyDownloads !== undefined">{{
              weekly(each.weeklyDownloads)
            }}</span>
          </p>
          <p
            v-if="each.description !== ''"
            class="ui:m-0 ui:ellipsis ui:text-tiny ui:text-fg-2"
            :title="each.description"
          >
            {{ each.description }}
          </p>
        </li>
      </ul>
    </form>
    <div
      v-if="workspace.installing !== null"
      role="group"
      aria-label="Install progress"
      class="ui:mbe-1.5 ui:flex ui:flex-col ui:gap-0.5 ui:bg-head ui:px-1.75 ui:py-1.5 ui:font-mono ui:text-tiny ui:text-fg-2"
      data-testid="install-progress"
    >
      <p class="ui:m-0 ui:text-fg">
        {{ workspace.installing.action === "add" ? "Installing" : "Removing" }}
        {{ workspace.installing.names.map(shown).join(", ") }}…
      </p>
      <p
        v-for="(line, at) in workspace.installing.lines.slice(-6)"
        :key="at"
        class="ui:m-0 ui:ellipsis"
      >
        {{ line }}
      </p>
    </div>
    <div
      v-if="workspace.failure !== null && workspace.installing === null"
      role="alert"
      class="ui:mbe-1.5 ui:flex ui:flex-col ui:gap-0.5 ui:bg-err-soft ui:px-1.75 ui:py-1.5 ui:text-tiny"
      data-testid="install-failure"
    >
      <p class="ui:m-0 ui:flex ui:items-center ui:gap-2 ui:font-semibold ui:text-err-text">
        <span class="ui:flex-1">
          {{ workspace.failure.action === "add" ? "Could not install" : "Could not remove" }}
          {{ workspace.failure.names.map(shown).join(", ") }}
        </span>
        <button
          type="button"
          :class="[wordButton, 'ui:bg-sheet']"
          @click="workspace.failure = null"
        >
          Dismiss
        </button>
      </p>
      <p class="ui:m-0 ui:font-mono ui:wrap-anywhere ui:text-fg">{{ workspace.failure.error }}</p>
    </div>
    <div v-if="missing.length > 0" class="ui:flex ui:flex-col ui:pbe-1.5">
      <p id="missing-title" class="ui:m-0 ui:px-1.75 ui:text-tiny ui:text-muted">Missing</p>
      <ul aria-labelledby="missing-title" class="ui:m-0 ui:flex ui:list-none ui:flex-col ui:p-0">
        <li
          v-for="name in missing"
          :key="name"
          class="ui:flex ui:items-center ui:gap-2 ui:ps-1.75 ui:pe-1 ui:block-6.5"
        >
          <span class="ui:flex-1 ui:ellipsis ui:font-mono ui:text-[0.71875rem] ui:text-fg">{{
            name
          }}</span>
          <button
            type="button"
            :class="[wordButton, 'ui:bg-sheet']"
            :disabled="busy || off"
            @click="install([name])"
          >
            Install {{ name }}
          </button>
        </li>
      </ul>
    </div>
    <ul
      v-if="workspace.packages.length > 0"
      aria-label="Installed packages"
      class="ui:m-0 ui:flex ui:list-none ui:flex-col ui:p-0"
    >
      <li
        v-for="each in workspace.packages"
        :key="each.name"
        class="ui:group/row ui:flex ui:items-center ui:gap-2 ui:rounded-control ui:ps-1.75 ui:pe-1 ui:block-6.5 ui:min-inline-0 ui:hover:bg-sheet ui:has-[:focus-visible]:bg-sheet"
      >
        <span class="ui:ellipsis ui:font-mono ui:text-[0.71875rem] ui:text-fg ui:min-inline-0">{{
          each.name
        }}</span>
        <span :class="rowEnd" :title="each.version">{{
          /^(?:file|link):/u.test(each.version) ? "local" : each.version
        }}</span>
        <button
          type="button"
          :aria-label="`Remove ${each.name}`"
          :class="[wordButton, rowAction]"
          :disabled="busy || off"
          @click="dispatcher.dispatch('ui.packages.remove', { names: [each.name] })"
        >
          Remove
        </button>
      </li>
    </ul>
  </Section>
</template>
