<!-- HomeSide: Home's Explorer, as VS Code's: its title with the icon that hides it; the workspace folder's section (its name, its path in the tooltip) with New Notebook, Refresh and Collapse Folders on hover, holding the notebooks as a file tree (FileTree) with the rows' right-click menu; then Running, the open notebooks' kernels with a count, folded while none runs, each row with Stop. A folder picked in the tree narrows the list to it; a notebook picked selects its row; a double click or Enter opens it. -->
<script setup lang="ts">
import {
  FilePlus,
  ListChevronsDownUp,
  LoaderCircle,
  NotebookText,
  PanelLeftClose,
  RefreshCw,
  Square,
} from "@lucide/vue";
import { computed, nextTick, watch } from "vue";

import FileTree from "../app/FileTree.vue";
import { keysFor, keyWords } from "../keyboard/keymap";
import Section from "../panel/Section.vue";
import IconButton from "../primitives/icon-button/IconButton.vue";
import { useHomeStore } from "../store/home";
import { splitPath } from "../store/homeRows";
import type { TreeNode } from "../store/homeTree";
import { treeOf } from "../store/homeTree";
import HomeContextMenu from "./HomeContextMenu.vue";
import RenameField from "./RenameField.vue";

const props = defineProps<{ folder: string; mac: boolean }>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();
const home = useHomeStore();

const nodes = computed(() => treeOf(home.notebooks.map((each) => each.path)));
const states = computed(() =>
  Object.fromEntries(
    home.notebooks
      .filter((each) => each.open)
      .map(
        (each) => [each.path, home.kernels[each.path]?.state === "busy" ? "busy" : "open"] as const,
      ),
  ),
);
const running = computed(() =>
  home.notebooks
    .filter((each) => each.open)
    .map((each) => ({
      path: each.path,
      name: splitPath(each.path).name.replace(/\.jsnb$/u, ""),
      busy: home.kernels[each.path]?.state === "busy",
    })),
);
/** The tree's selected row: the folder the list shows, else the selected notebook. */
const selected = computed(() => (home.folder === "" ? home.selected : `${home.folder}/`));
const expanded = computed({
  get: () => [...home.expanded],
  set: (keys: string[]) => {
    home.expanded = keys;
  },
});
function picked(node: TreeNode): void {
  if (node.folder) {
    emit("command", "ui.home.folder", { folder: home.folder === node.path ? "" : node.path });
    return;
  }
  home.folder = "";
  home.selected = node.path;
}
const run = (command: string, node: TreeNode) => {
  emit("command", command, {
    path: node.path,
    ...(command === "ui.notebook.rename" ? { where: "tree" } : {}),
  });
};
const hideKeys = computed(() => {
  const bound = keysFor("ui.home.side.toggle");
  return bound === undefined ? undefined : keyWords(bound, props.mac);
});
// Side effect: a rename in the tree that ends (renamed or cancelled) gives the focus back to its row when it was lost.
watch(
  () => home.renaming,
  async (now, before) => {
    if (now !== null || before === null || home.renameIn !== "tree") return;
    await nextTick();
    // only a focus left nowhere comes back: one the palette or a click took stays there
    const active = document.activeElement;
    if (
      active !== null &&
      active !== document.body &&
      document.getElementById("side")?.contains(active) !== true
    )
      return;
    const key = home.selected ?? before;
    document.querySelector<HTMLElement>(`#side [data-key="${CSS.escape(key)}"]`)?.focus();
  },
);
const icon = "ui:block-3.5 ui:inline-3.5";
</script>

<template>
  <header class="ui:flex ui:shrink-0 ui:items-center ui:gap-2 ui:ps-1 ui:block-8.5 ui:min-inline-0">
    <h2
      id="side-title"
      class="ui:tracking-wide ui:m-0 ui:flex-1 ui:text-tiny ui:font-semibold ui:text-fg-2 ui:uppercase"
    >
      Explorer
    </h2>
    <IconButton
      label="Hide Explorer"
      :keys="hideKeys"
      data-hide="side"
      class="ui:block-6 ui:inline-6"
      @click="emit('command', 'ui.home.side.toggle')"
    >
      <PanelLeftClose :class="icon" aria-hidden="true" />
    </IconButton>
  </header>
  <div class="ui:flex ui:flex-1 ui:flex-col ui:overflow-y-auto ui:min-block-0">
    <Section name="workspace" :title="props.folder || 'Workspace'" hover-tools>
      <template #tools>
        <IconButton
          label="New Notebook"
          class="ui:block-6 ui:inline-6"
          @click="emit('command', 'ui.notebook.new')"
        >
          <FilePlus :class="icon" aria-hidden="true" />
        </IconButton>
        <IconButton
          label="Refresh"
          class="ui:block-6 ui:inline-6"
          @click="emit('command', 'ui.home.refresh')"
        >
          <RefreshCw :class="icon" aria-hidden="true" />
        </IconButton>
        <IconButton
          label="Collapse Folders"
          class="ui:block-6 ui:inline-6"
          @click="emit('command', 'ui.home.collapseAll')"
        >
          <ListChevronsDownUp :class="icon" aria-hidden="true" />
        </IconButton>
      </template>
      <HomeContextMenu :mac="props.mac" where="tree">
        <div>
          <FileTree
            v-model:expanded="expanded"
            :nodes="nodes"
            :selected="selected"
            :states="states"
            :renaming="home.renameIn === 'tree' ? home.renaming : null"
            label="Notebooks"
            @select="picked"
            @open="(node) => run('ui.notebook.open', node)"
            @rename="(node) => run('ui.notebook.rename', node)"
            @remove="(node) => run('ui.notebook.delete', node)"
          >
            <template #rename="{ node }">
              <RenameField :path="node.path" @command="(id, args) => emit('command', id, args)" />
            </template>
          </FileTree>
        </div>
      </HomeContextMenu>
    </Section>
    <Section name="running" title="Running" :count="running.length">
      <ul
        aria-label="Running kernels"
        data-testid="running"
        class="ui:m-0 ui:flex ui:list-none ui:flex-col ui:p-0"
      >
        <li
          v-for="row in running"
          :key="row.path"
          :data-path="row.path"
          class="ui:group ui:flex ui:items-center ui:gap-1.5 ui:rounded-small ui:ps-5 ui:pe-1 ui:text-fg-2 ui:block-[1.375rem] ui:hover:bg-well"
          :title="row.path"
        >
          <NotebookText
            class="ui:shrink-0 ui:text-fill ui:block-3.5 ui:inline-3.5"
            aria-hidden="true"
          />
          <button
            type="button"
            class="ui:flex-1 ui:cursor-pointer ui:ellipsis ui:border-0 ui:bg-transparent ui:p-0 ui:text-start ui:font-inherit ui:text-inherit ui:min-inline-0"
            @click="emit('command', 'ui.notebook.open', { path: row.path })"
          >
            {{ row.name }}
          </button>
          <LoaderCircle
            v-if="row.busy"
            class="ui:shrink-0 ui:text-hot ui:block-3 ui:inline-3 ui:motion-safe:animate-spin"
            aria-label="running"
          />
          <IconButton
            :label="`Stop ${row.name}`"
            :data-testid="`stop-${row.path}`"
            class="ui:opacity-0 ui:block-5 ui:inline-5 ui:group-hover:opacity-100 ui:focus-visible:opacity-100"
            @click="emit('command', 'ui.notebook.close', { path: row.path })"
          >
            <Square class="ui:block-3 ui:inline-3" aria-hidden="true" />
          </IconButton>
        </li>
      </ul>
    </Section>
  </div>
</template>
