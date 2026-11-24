<!-- KeybindingsTable: Keyboard Shortcuts' table, a grid with one tabbable row that the arrows, Page Up, Page Down, Home and End move (Up on the first row goes back to the search). Double click a row, or Enter, to record its keys; Delete removes its key. The right-click menu has VS Code's actions (KeybindingMenu). Writes go to the file of `scope`. -->
<script setup lang="ts">
import type { Keybinding } from "@jsnb/core";
import { ContextMenuRoot, ContextMenuTrigger } from "reka-ui";
import { computed, nextTick, ref, toRef } from "vue";

import type { KeyRow } from "../keyboard/keybindingRows";
import type { Scope } from "../store/settings";
import KeybindingMenu from "./KeybindingMenu.vue";
import KeybindingRow from "./KeybindingRow.vue";
import { keybindingActions } from "./keybindingActions";

const props = defineProps<{
  rows: readonly KeyRow[];
  entries: readonly Keybinding[];
  scope: Scope;
  off: boolean;
  mac: boolean;
}>();
const emit = defineEmits<{ same: [keys: string]; leave: [] }>();
const actions = keybindingActions({
  entries: () => props.entries,
  scope: toRef(props, "scope"),
  mac: props.mac,
});

const focused = ref(0);
const table = ref<HTMLElement | null>(null);
const recording = ref<{ readonly id: string; readonly mode: "change" | "add" } | null>(null);
const editingWhen = ref<string | null>(null);
const menuRow = ref<KeyRow | null>(null);
const editable = (row: KeyRow) => row.target !== null && !props.off;

function focusRow(index: number): void {
  focused.value = Math.max(0, Math.min(index, props.rows.length - 1));
  void nextTick(() => {
    table.value?.querySelector<HTMLElement>(`[data-index="${String(focused.value)}"]`)?.focus();
  });
}
defineExpose({ focusRow });
function stop(): void {
  recording.value = null;
  editingWhen.value = null;
  focusRow(focused.value);
}
const run = {
  record: (row: KeyRow, mode: "change" | "add" = "change") => {
    if (editable(row)) recording.value = { id: row.id, mode };
  },
  when: (row: KeyRow) => {
    if (editable(row) && row.keys.length > 0) editingWhen.value = row.id;
  },
  remove: (row: KeyRow) => {
    if (editable(row)) void actions.remove(row);
  },
  reset: (row: KeyRow) => {
    if (!props.off) void actions.reset(row);
  },
  same: (row: KeyRow) => {
    const keys = row.keys[0];
    if (keys !== undefined) emit("same", keys);
  },
};
async function saveKeys(row: KeyRow, keys: string): Promise<void> {
  const mode = recording.value?.mode ?? "change";
  stop();
  await actions.record(row, keys, mode);
}
async function saveWhen(row: KeyRow, text: string, done: (problem: string | null) => void) {
  const problem = await actions.moveWhen(row, text);
  done(problem);
  if (problem === null) stop();
}
const moves = (index: number): Readonly<Record<string, number>> => ({
  ArrowDown: index + 1,
  ArrowUp: index - 1,
  PageDown: index + 15,
  PageUp: index - 15,
  Home: 0,
  End: props.rows.length - 1,
});
/** What a key on a focused row does, or undefined when it is not the table's. */
function rowAction(key: string, row: KeyRow, index: number): (() => void) | undefined {
  if (key === "Enter")
    return () => {
      run.record(row);
    };
  if (key === "Delete" || key === "Backspace")
    return () => {
      run.remove(row);
    };
  if (key === "ArrowUp" && index === 0)
    return () => {
      emit("leave");
    };
  const to = moves(index)[key];
  return to === undefined
    ? undefined
    : () => {
        focusRow(to);
      };
}
function rowKey(event: KeyboardEvent, row: KeyRow, index: number): void {
  const action =
    event.target === event.currentTarget ? rowAction(event.key, row, index) : undefined;
  if (action === undefined) return;
  event.preventDefault();
  event.stopPropagation();
  action();
}
function aimed(event: MouseEvent): void {
  const element =
    event.target instanceof Element ? event.target.closest<HTMLElement>("[data-index]") : null;
  const index = Number(element?.dataset.index ?? "-1");
  menuRow.value = props.rows[index] ?? null;
  if (index >= 0) focused.value = index;
}
const cols =
  "ui:grid ui:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(5rem,0.35fr)] ui:items-center ui:gap-x-4 ui:px-3";
const count = computed(() => props.rows.length);
</script>

<template>
  <ContextMenuRoot :modal="false">
    <ContextMenuTrigger as-child @contextmenu.capture="aimed">
      <div
        ref="table"
        role="grid"
        aria-label="Keybindings"
        :aria-rowcount="count"
        data-testid="keybindings-table"
        class="ui:mbs-3 ui:mbe-4 ui:flex ui:flex-1 ui:flex-col ui:overflow-y-auto ui:rounded-control ui:border ui:border-border ui:min-block-0"
      >
        <div
          role="row"
          :class="[
            cols,
            'ui:sticky ui:inset-bs-0 ui:z-(--z-toolbar) ui:shrink-0 ui:border-be ui:border-border ui:bg-side ui:text-tiny ui:font-medium ui:text-muted ui:block-7',
          ]"
        >
          <span role="columnheader">Command</span>
          <span role="columnheader">Keybinding</span>
          <span role="columnheader">When</span>
          <span role="columnheader">Source</span>
        </div>
        <KeybindingRow
          v-for="(row, index) in props.rows"
          :key="row.id"
          :row="row"
          :entries="props.entries"
          :recording="recording?.id === row.id"
          :editing-when="editingWhen === row.id"
          :mac="props.mac"
          :cols="cols"
          :data-index="index"
          :tabindex="index === focused ? 0 : -1"
          :aria-selected="index === focused"
          :class="[
            'ui:focus-visible:bg-select ui:shrink-0 ui:select-none ui:block-8 ui:hover:bg-head ui:aria-selected:bg-well',
            index % 2 === 1 ? 'ui:bg-sheet-2' : '',
          ]"
          @click="focused = index"
          @dblclick="run.record(row)"
          @keydown="rowKey($event, row, index)"
          @keys="(keys) => saveKeys(row, keys)"
          @when="(text, done) => saveWhen(row, text, done)"
          @cancel="stop"
          @same="run.same(row)"
        />
        <p v-if="count === 0" class="ui:m-0 ui:px-3 ui:py-3 ui:text-small ui:text-muted">
          No keybindings found
        </p>
      </div>
    </ContextMenuTrigger>
    <KeybindingMenu
      :row="menuRow"
      :editable="menuRow !== null && editable(menuRow)"
      :mac="props.mac"
      @run="(action, row) => run[action](row)"
      @add="(row) => run.record(row, 'add')"
      @closed="focusRow(focused)"
    />
  </ContextMenuRoot>
</template>
