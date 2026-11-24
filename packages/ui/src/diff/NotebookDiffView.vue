<!-- NotebookDiffView: a notebook's diff, cell by cell (after ReviewNB and GitNotebooks): a summary line ("2 modified, 1 added, 1 removed"), the header's changes with Metadata Changes on, then the changed cells with the unchanged cells around them (notebookDiff.contextCells, one by default) and the rest folded into "N unchanged cells" rows that expand; Show Entire Notebook draws every cell. -->
<script setup lang="ts">
import type { NotebookDiff } from "@jsnb/core";
import { ChevronsUpDown } from "@lucide/vue";
import { computed, ref } from "vue";

import { useSettingsStore } from "../store/settings";
import { useUiStore } from "../store/ui";
import DiffCell from "./DiffCell.vue";
import { shownRows } from "./notebookRows";

const props = defineProps<{ diff: NotebookDiff; sideBySide: boolean }>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();
const settings = useSettingsStore();
const ui = useUiStore();
const expanded = ref<ReadonlySet<string>>(new Set());
const options = computed(() => ({
  entire: settings.valueOf("notebookDiff.showEntireNotebook") === true,
  context: Number(settings.valueOf("notebookDiff.contextCells") ?? 1),
  metadata: settings.valueOf("notebookDiff.showMetadata") === true,
  hideOutputs: settings.valueOf("notebookDiff.hideOutputs") === true,
  raw: settings.valueOf("notebookDiff.rawMarkdown") === true,
}));
const rows = computed(() =>
  shownRows(props.diff.rows, { ...options.value, expanded: expanded.value }),
);
const summary = computed(() => {
  const { added, removed, modified, moved } = props.diff.stats;
  const parts = [
    modified > 0 ? `${String(modified)} modified` : "",
    added > 0 ? `${String(added)} added` : "",
    removed > 0 ? `${String(removed)} removed` : "",
    moved > 0 ? `${String(moved)} moved` : "",
  ].filter(Boolean);
  const hidden =
    options.value.hideOutputs && props.diff.rows.some((row) => row.changes.outputs)
      ? " · outputs hidden"
      : "";
  return (parts.length === 0 ? "No cell changes" : parts.join(", ")) + hidden;
});
const expand = (key: string) => {
  expanded.value = new Set([...expanded.value, key]);
};
const shown = (value: unknown) => (value === undefined ? "—" : JSON.stringify(value));
const open = (cell: string) => {
  emit("command", "ui.git.openFile", { path: ui.diff?.path, cell });
};
</script>

<template>
  <div data-testid="notebook-diff" class="ui:flex ui:flex-col ui:gap-2 ui:px-6 ui:py-4">
    <p class="ui:m-0 ui:text-small ui:text-muted" data-testid="diff-summary">{{ summary }}</p>
    <dl
      v-if="options.metadata && props.diff.header.length > 0"
      class="ui:m-0 ui:grid ui:grid-cols-[auto_1fr] ui:gap-x-3 ui:font-mono ui:text-tiny"
    >
      <template v-for="change in props.diff.header" :key="change.key">
        <dt class="ui:text-muted">{{ change.key }}</dt>
        <dd class="ui:m-0 ui:text-fg-2">{{ shown(change.from) }} → {{ shown(change.to) }}</dd>
      </template>
    </dl>
    <template v-for="item in rows" :key="item.key">
      <button
        v-if="item.kind === 'fold'"
        type="button"
        data-part="fold"
        class="ui:flex ui:cursor-pointer ui:items-center ui:gap-2 ui:border ui:border-dashed ui:border-border ui:bg-transparent ui:px-3 ui:font-inherit ui:text-small ui:text-muted ui:block-7 ui:hover:bg-well ui:hover:text-fg"
        @click="expand(item.key)"
      >
        <ChevronsUpDown class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
        {{ item.count === 1 ? "1 unchanged cell" : `${String(item.count)} unchanged cells` }}
      </button>
      <DiffCell
        v-else
        :row="item.row"
        :changed="item.changed"
        :side-by-side="props.sideBySide"
        :raw-markdown="options.raw"
        :metadata="options.metadata"
        :outputs="!options.hideOutputs"
        @open="open"
      />
    </template>
  </div>
</template>
