<!-- HomeList: the middle of the Home page: a toolbar with the search field (HomeSearch), the folder the Explorer narrowed the list to (a chip that clears it) and New Notebook; then one table of notebooks under its column header (Name, Folder, Kernel, Cells, Routes, Modified). With words typed, the matches, then the row that creates the typed name. A click selects a row, a double click opens it, a right click shows its menu; with the list focused Home's keys act on the selected row. An empty workspace shows New Notebook, Open Folder and the shipped examples. -->
<script setup lang="ts">
import { FilePlus, FolderOpen, Plus, X } from "@lucide/vue";
import { nextTick, toRef, watch } from "vue";

import { keysShown, keyWords } from "../keyboard/keymap";
import Button from "../primitives/button/Button.vue";
import { useHomeStore } from "../store/home";
import HomeContextMenu from "./HomeContextMenu.vue";
import HomeRow from "./HomeRow.vue";
import HomeSearch from "./HomeSearch.vue";
import { useHomeRows } from "./useHomeRows";

const props = defineProps<{ now: number; mac: boolean }>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();

const home = useHomeStore();
const { list, typed, empty, created, rowId, rows } = useHomeRows(toRef(props, "now"));
function select(path: string): void {
  home.selected = path;
}
// Side effect: what is typed selects the best match, or nothing when no notebook fits (Enter then opens nothing).
watch(
  () => home.query,
  () => {
    const found = list.value;
    if (found.searching) home.selected = found.matches[0]?.path ?? null;
  },
);
// Side effect: the selected row moved by the keys stays in view.
watch(
  () => home.selected,
  async (path) => {
    if (path === null) return;
    await nextTick();
    document.getElementById(rowId(path))?.scrollIntoView({ block: "nearest" });
  },
);
const command = (id: string, args?: Record<string, unknown>) => {
  emit("command", id, args);
};
const grid =
  "ui:grid ui:grid-cols-[2.25rem_minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)_3.5rem_minmax(0,1.6fr)_7rem] ui:items-center ui:gap-x-3 ui:pe-4";
</script>

<template>
  <div class="ui:flex ui:shrink-0 ui:items-center ui:gap-2 ui:ps-4 ui:pe-4 ui:block-12">
    <HomeSearch
      :mac="props.mac"
      :active="home.selected === null ? undefined : rowId(home.selected)"
      :empty="empty"
      @command="command"
    />
    <button
      v-if="home.folder !== ''"
      type="button"
      data-testid="folder-filter"
      :aria-label="`Show every notebook, not only ${home.folder}`"
      class="ui:inline-flex ui:shrink-0 ui:cursor-pointer ui:items-center ui:gap-1 ui:rounded-[1em] ui:border ui:border-border ui:bg-sheet ui:px-2 ui:font-mono ui:text-tiny ui:text-fg-2 ui:block-6 ui:hover:text-fg ui:focus-visible:border-accent"
      @click="command('ui.home.folder', { folder: '' })"
    >
      {{ home.folder }}/
      <X class="ui:block-3 ui:inline-3" aria-hidden="true" />
    </button>
    <span class="ui:flex-1" />
    <Button
      data-testid="new-notebook"
      :title="keysShown('ui.notebook.new', props.mac)"
      @click="command('ui.notebook.new', typed === '' ? undefined : { name: typed })"
      ><Plus class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />New Notebook</Button
    >
  </div>
  <div v-if="empty" data-testid="empty" class="ui:flex ui:flex-col ui:gap-4 ui:ps-12 ui:pbs-10">
    <p class="ui:m-0 ui:text-title ui:font-semibold ui:text-fg">No notebooks</p>
    <div class="ui:flex ui:gap-2">
      <Button variant="go" @click="command('ui.notebook.new')"
        ><FilePlus class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />New Notebook</Button
      >
      <Button @click="command('ui.home.openFolder')"
        ><FolderOpen class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />Open Folder…</Button
      >
    </div>
    <section
      v-if="home.examples.length > 0"
      aria-labelledby="examples-title"
      data-testid="examples"
    >
      <h2
        id="examples-title"
        class="ui:tracking-wide ui:m-0 ui:mbe-1.5 ui:text-tiny ui:font-semibold ui:text-fg-2 ui:uppercase"
      >
        Examples
      </h2>
      <ul class="ui:m-0 ui:flex ui:list-none ui:flex-col ui:gap-0.5 ui:p-0">
        <li v-for="example in home.examples" :key="example.name">
          <button
            type="button"
            :data-example="example.name"
            :title="example.purpose"
            class="ui:cursor-pointer ui:border-0 ui:bg-transparent ui:p-0 ui:font-inherit ui:text-accent-text ui:hover:underline"
            @click="command('ui.home.example', { name: example.name })"
          >
            {{ example.title }}
          </button>
        </li>
      </ul>
    </section>
  </div>
  <template v-else>
    <div
      data-part="home-columns"
      aria-hidden="true"
      :class="[
        grid,
        'ui:shrink-0 ui:border-be ui:border-border ui:text-tiny ui:font-medium ui:text-muted ui:block-7',
      ]"
    >
      <span />
      <span>Name</span>
      <span>Folder</span>
      <span>Kernel</span>
      <span class="ui:text-end">Cells</span>
      <span>Routes</span>
      <span>Modified</span>
    </div>
    <HomeContextMenu :mac="props.mac" where="list">
      <div class="ui:flex-1 ui:overflow-y-auto ui:pbe-4 ui:min-block-0">
        <div
          id="home-list"
          role="listbox"
          tabindex="0"
          aria-label="Notebooks"
          data-testid="notebooks"
          class="ui:focus-visible:shadow-[inset_0_0_0_2px_var(--guide-on)]"
        >
          <HomeRow
            v-for="row in rows"
            :id="rowId(row.path)"
            :key="row.path"
            :row="row"
            :selected="home.selected === row.path"
            :renaming="home.renaming === row.path && home.renameIn === 'list'"
            :grid="grid"
            @select="select"
            @command="command"
          />
          <p
            v-if="!list.searching && rows.length === 0"
            class="ui:m-0 ui:ps-12 ui:pbs-4 ui:text-muted"
          >
            No notebooks in {{ home.folder }}
          </p>
          <p
            v-if="list.searching && rows.length === 0"
            class="ui:m-0 ui:ps-12 ui:pbs-4 ui:text-muted"
          >
            No results
          </p>
          <button
            v-if="list.searching"
            type="button"
            data-testid="create-row"
            :class="[
              grid,
              'ui:cursor-pointer ui:border-0 ui:bg-transparent ui:text-start ui:font-inherit ui:block-8 ui:inline-full ui:hover:bg-head ui:focus-visible:shadow-[inset_0_0_0_2px_var(--guide-on)]',
            ]"
            @click="command('ui.notebook.new', { name: typed })"
          >
            <Plus
              class="ui:justify-self-center ui:text-muted ui:block-3.5 ui:inline-3.5"
              aria-hidden="true"
            />
            <span class="ui:col-span-5 ui:ellipsis ui:text-fg-2"
              >New notebook
              <span class="ui:font-mono ui:text-code ui:text-fg">{{ created }}</span></span
            >
            <span class="ui:text-tiny ui:whitespace-nowrap ui:text-muted">{{
              keyWords("Mod+Enter", props.mac)
            }}</span>
          </button>
        </div>
      </div>
    </HomeContextMenu>
  </template>
</template>
