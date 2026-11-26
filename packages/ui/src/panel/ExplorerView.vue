<!-- ExplorerView: where things are, as VS Code's Explorer. Outline: the notebook's markdown headings nested by level, and under them the cells a heading does not tell about (a title, a run going, a failed run, a stale result, an unreviewed agent edit); outline.showAllCells lists every cell instead. A click goes to the cell. Below, the workspace's notebooks as a file tree, unfolded down to this one. -->
<script setup lang="ts">
import { staleReason } from "@jsnb/core";
import { CircleX, History, LoaderCircle } from "@lucide/vue";
import { computed, onMounted, ref, watch } from "vue";

import FileTree from "../app/FileTree.vue";
import { baseName } from "../app/models";
import TypeIcon from "../cells/TypeIcon.vue";
import { changedBy, pendingEdit, whenOf } from "../cells/agentEdit";
import { useCellNames } from "../cells/names";
import { typeTone } from "../cells/tones";
import { useDispatcher } from "../commands/dispatch";
import { notebookPageUrl } from "../store/address";
import type { TreeNode } from "../store/homeTree";
import { folderKeysOf, treeOf } from "../store/homeTree";
import { useNotebookStore } from "../store/notebook";
import { useSettingsStore } from "../store/settings";
import { useUiStore } from "../store/ui";
import { useWorkspaceStore } from "../store/workspace";
import Section from "./Section.vue";
import ViewHead from "./ViewHead.vue";
import { outlineOf } from "./outline";
import { rowButton } from "./rows";

const dispatcher = useDispatcher();
const store = useNotebookStore();
const ui = useUiStore();
const workspace = useWorkspaceStore();
const settings = useSettingsStore();

const names = useCellNames();
type Row = (typeof store.cellsInOrder)[number];
/** "Lines 2 to 3 changed by claude-code today at 14:02, not reviewed": the dot's tooltip, for a cell with an agent
 * edit no one reviewed yet. */
const agentOf = (cell: Row): string | null => {
  const edit = pendingEdit(cell.meta);
  if (edit === null) return null;
  const words = changedBy(edit);
  const when = whenOf(edit.at);
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}${when === "" ? "" : ` ${when}`}, not reviewed`;
};
/** "Stale: count changed in cell 2": the clock's words, for a stale cell. */
const staleOf = (cell: Row): string | null => {
  if (!cell.stale) return null;
  const { graph } = store.mirror;
  const numberOf = (id: string) => store.cellsInOrder.findIndex((each) => each.id === id) + 1;
  const why =
    cell.staleWhy ?? staleReason(graph.get(cell.id), (id) => graph.get(id), false, numberOf);
  return why === "" ? "Stale" : `Stale: ${why}`;
};
const all = computed(() => settings.valueOf("outline.showAllCells") === true);
const outline = computed(() => {
  const byId = new Map(store.cellsInOrder.map((cell, at) => [cell.id, { cell, at }]));
  const rows = all.value
    ? store.cellsInOrder.map((cell) => ({
        key: cell.id,
        cell: cell.id,
        heading: false,
        depth: 0,
        text: names.value.get(cell.id) ?? "",
      }))
    : outlineOf(store.cellsInOrder, names.value);
  return rows.flatMap((row) => {
    const found = byId.get(row.cell);
    if (found === undefined) return [];
    const { cell, at } = found;
    return [
      {
        ...row,
        text: row.text || (all.value ? "" : `cell ${String(at + 1)}`),
        number: at + 1,
        type: cell.type,
        running: cell.status === "running",
        failed: cell.status === "error",
        stale: staleOf(cell),
        agent: agentOf(cell),
      },
    ];
  });
});
const step = 0.75;
const indent = (depth: number) => ({ paddingInlineStart: `${String(0.25 + depth * step)}rem` });
const guides = (depth: number) => ({
  insetInlineStart: `${String(0.5)}rem`,
  inlineSize: `${String(depth * step)}rem`,
  backgroundImage: `repeating-linear-gradient(to right, var(--border) 0 0.0625rem, transparent 0.0625rem ${String(step)}rem)`,
});
const notebooks = computed(() => workspace.info?.notebooks ?? []);
const nodes = computed(() => treeOf(notebooks.value.map((each) => each.path)));
const states = computed(() =>
  Object.fromEntries(
    notebooks.value.filter((each) => each.open).map((each) => [each.path, "open"] as const),
  ),
);
const here = computed(() => store.mirror.notebook?.path ?? "");
const expanded = ref<string[]>([]);
// Side effect: the tree unfolds down to this notebook once its path is known.
watch(
  here,
  (path) => {
    if (path !== "") expanded.value = [...new Set([...expanded.value, ...folderKeysOf(path)])];
  },
  { immediate: true },
);
const go = (node: TreeNode) => {
  if (!node.folder && node.path !== here.value)
    location.assign(notebookPageUrl(node.path, location));
};
// A notebook an agent created since the page loaded is in the list: opened later, the view reads the workspace again.
// At the page's own start the workspace store is already reading it, and a page whose start stopped has no session
// to ask, so the view asks nothing then.
onMounted(() => {
  if (workspace.info !== null && store.started) void workspace.refreshInfo();
});
</script>

<template>
  <ViewHead id="side-title" title="Explorer" region="side" />
  <div class="ui:flex ui:flex-1 ui:flex-col ui:overflow-y-auto ui:min-block-0">
    <Section name="outline" title="Outline" :empty="outline.length === 0">
      <ol aria-label="Outline" class="ui:m-0 ui:flex ui:list-none ui:flex-col ui:p-0">
        <li v-for="row in outline" :key="row.key" class="ui:relative">
          <span
            v-if="row.depth > 0"
            aria-hidden="true"
            data-part="guide"
            :style="guides(row.depth)"
            class="ui:pointer-events-none ui:absolute ui:inset-bs-0 ui:inset-be-0"
          />
          <button
            type="button"
            :aria-current="ui.selected === row.cell ? 'true' : undefined"
            :data-heading="row.heading ? '' : undefined"
            :class="rowButton"
            :style="indent(row.depth)"
            :title="row.text"
            @click="dispatcher.dispatch('ui.select', { cell: row.cell })"
          >
            <template v-if="all">
              <span
                class="ui:shrink-0 ui:text-end ui:font-mono ui:text-tiny ui:text-muted ui:inline-4"
                >{{ row.number }}</span
              >
              <TypeIcon
                :type="row.type"
                :class="['ui:shrink-0 ui:block-3.25 ui:inline-3.25', typeTone[row.type]]"
              />
            </template>
            <span
              :class="[
                'ui:ellipsis ui:min-inline-0',
                row.heading ? 'ui:text-fg' : 'ui:text-fg-2',
                row.type === 'markdown' ? '' : 'ui:font-mono',
              ]"
              >{{ row.text }}</span
            >
            <span
              v-if="row.agent !== null"
              data-part="agent-edit"
              role="img"
              :title="row.agent"
              :aria-label="row.agent"
              class="ui:shrink-0 ui:rounded-[1em] ui:bg-agent ui:block-1.5 ui:inline-1.5"
            />
            <LoaderCircle
              v-if="row.running"
              class="ui:ms-auto ui:shrink-0 ui:text-hot ui:block-3 ui:inline-3 ui:motion-safe:animate-spin"
              aria-label="running"
            />
            <CircleX
              v-else-if="row.failed"
              class="ui:ms-auto ui:shrink-0 ui:text-err ui:block-3 ui:inline-3"
              aria-label="failed"
            />
            <span
              v-else-if="row.stale !== null"
              data-part="stale"
              role="img"
              :title="row.stale"
              :aria-label="row.stale"
              class="ui:ms-auto ui:flex ui:shrink-0 ui:text-warn"
              ><History class="ui:block-3 ui:inline-3" aria-hidden="true"
            /></span>
          </button>
        </li>
      </ol>
    </Section>
    <Section name="workspace" :title="baseName(workspace.info?.root ?? '') || 'Workspace'">
      <div :title="workspace.info?.root" data-testid="workspace-tree">
        <FileTree
          v-model:expanded="expanded"
          :nodes="nodes"
          :selected="here === '' ? null : here"
          :current="here"
          :states="states"
          label="Notebooks"
          @select="go"
          @open="go"
        />
      </div>
    </Section>
  </div>
</template>
