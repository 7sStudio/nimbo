<!-- ProblemsTab: the bottom panel's Problems tab: the cells whose last run failed, then the language service's diagnostics, errors before warnings (derived, never stored), under one column header: place, name or code, message; a click on a run error selects the cell, unfolds it if it was folded and brings its error into view; a click on a diagnostic also puts the caret on its range. The tab carries the same count. -->
<script setup lang="ts">
import type { Cell, Diagnostic } from "@jsnb/core";
import { computed, nextTick } from "vue";

import { runsOff } from "../app/useShell";
import { useDispatcher } from "../commands/dispatch";
import { viewOf } from "../editor/language/host";
import { useNotebookStore } from "../store/notebook";
import { useUiStore } from "../store/ui";
import { note } from "./rows";

const dispatcher = useDispatcher();
const store = useNotebookStore();
const ui = useUiStore();
const numbers = computed(() => new Map(store.cellsInOrder.map((cell, at) => [cell.id, at + 1])));
const rows = computed(() =>
  store.errors.map((cell) => {
    const error = store.lastExecutionOf(cell.id)?.error;
    return {
      cell,
      number: numbers.value.get(cell.id) ?? 0,
      name: error?.name ?? "Error",
      message: error?.message ?? "",
    };
  }),
);

/** The service's diagnostics, cell by cell in order, each cell's errors before its warnings. */
const diagnostics = computed(() =>
  store.cellsInOrder.flatMap((cell) =>
    [...(store.mirror.diagnostics.get(cell.id) ?? [])]
      .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1))
      .map((diagnostic, at) => ({
        key: `${cell.id}:${String(at)}`,
        cell,
        place: `Cell ${String(numbers.value.get(cell.id) ?? 0)}:${String(diagnostic.range.start.line + 1)}`,
        code:
          typeof diagnostic.code === "number" ? `TS${String(diagnostic.code)}` : diagnostic.code,
        diagnostic,
      })),
  ),
);

/** Opens the cell's editor and selects the diagnostic's range in it. */
async function reveal(cell: Cell, diagnostic: Diagnostic): Promise<void> {
  await open(cell);
  await dispatcher.dispatch("ui.mode.edit");
  await nextTick();
  const view = viewOf(cell.id);
  if (!view) return;
  const at = (line: number, character: number) => {
    const row = view.state.doc.line(Math.min(line + 1, view.state.doc.lines));
    return Math.min(row.from + character, row.to);
  };
  const { start, end } = diagnostic.range;
  view.dispatch({
    selection: { anchor: at(start.line, start.character), head: at(end.line, end.character) },
    scrollIntoView: true,
  });
  view.focus();
}

async function open(cell: Cell): Promise<void> {
  await dispatcher.dispatch("ui.select", { cell: cell.id });
  // expanding writes the cell's meta: a view-only or closed tab selects it and leaves it collapsed; a cell Fold All
  // folded opens on the page alone
  if (cell.meta.collapsed === true && !runsOff(store))
    await dispatcher.dispatch("ui.cell.toggleCollapse");
  else if (ui.foldAll) ui.setOpened(cell.id, true);
  await nextTick();
  const item = document.querySelector(`[data-cell="${cell.id}"]`);
  const error = item?.querySelector('[data-part="outputs"] > :last-child') ?? item;
  error?.scrollIntoView({ block: "nearest" });
}
</script>

<template>
  <div class="ui:flex ui:flex-1 ui:flex-col ui:overflow-y-auto ui:min-block-0">
    <template v-if="rows.length > 0 || diagnostics.length > 0">
      <div
        aria-hidden="true"
        class="ui:grid ui:grid-cols-[3.5rem_12rem_minmax(0,1fr)] ui:items-center ui:gap-3 ui:px-1 ui:text-tiny ui:text-muted ui:block-5"
      >
        <span>Cell</span><span>Problem</span><span>Message</span>
      </div>
      <ul aria-label="Errors" class="ui:m-0 ui:flex ui:list-none ui:flex-col ui:p-0">
        <li v-for="row in rows" :key="row.cell.id">
          <button
            type="button"
            class="ui:grid ui:cursor-pointer ui:grid-cols-[3.5rem_12rem_minmax(0,1fr)] ui:items-baseline ui:gap-3 ui:rounded-control ui:border ui:border-transparent ui:bg-transparent ui:px-1 ui:py-0.75 ui:text-start ui:font-inherit ui:text-[0.71875rem] ui:text-fg-2 ui:inline-full ui:hover:bg-sheet ui:focus-visible:border-accent"
            @click="open(row.cell)"
          >
            <span>Cell {{ row.number }}</span>
            <span class="ui:ellipsis ui:font-mono ui:font-medium ui:text-err">{{ row.name }}</span>
            <span class="ui:[overflow-wrap:anywhere] ui:text-fg">{{ row.message }}</span>
          </button>
        </li>
      </ul>
      <ul aria-label="Diagnostics" class="ui:m-0 ui:flex ui:list-none ui:flex-col ui:p-0">
        <li v-for="row in diagnostics" :key="row.key">
          <button
            type="button"
            class="ui:grid ui:cursor-pointer ui:grid-cols-[3.5rem_12rem_minmax(0,1fr)] ui:items-baseline ui:gap-3 ui:rounded-control ui:border ui:border-transparent ui:bg-transparent ui:px-1 ui:py-0.75 ui:text-start ui:font-inherit ui:text-[0.71875rem] ui:text-fg-2 ui:inline-full ui:hover:bg-sheet ui:focus-visible:border-accent"
            @click="reveal(row.cell, row.diagnostic)"
          >
            <span>{{ row.place }}</span>
            <span
              :class="[
                'ui:ellipsis ui:font-mono ui:font-medium',
                row.diagnostic.severity === 'error' ? 'ui:text-err' : 'ui:text-[var(--warn-text)]',
              ]"
              >{{ row.code }}</span
            >
            <span class="ui:[overflow-wrap:anywhere] ui:text-fg">{{ row.diagnostic.message }}</span>
          </button>
        </li>
      </ul>
    </template>
    <p v-else :class="note">No problems</p>
  </div>
</template>
