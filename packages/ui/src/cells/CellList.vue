<!-- CellList: the notebook's cells in order, each a separate block on one page: a list of labelled items ("Cell 3, server, ok") that is one tab stop, the selected item holding it; the gap between two blocks, which offers the add buttons on hover, and the add row after the last. It is where the cells meet the stores: models from useCells, every action through the dispatcher on the cell it came from. -->
<script setup lang="ts">
import type { CellId, CellMeta, CellType } from "@jsnb/core";
import { computed, inject, ref, watch } from "vue";

import { useDispatcher } from "../commands/dispatch";
import { isMac } from "../keyboard/modes";
import { useContainersStore } from "../store/containers";
import { useNotebookStore } from "../store/notebook";
import { useSettingsStore } from "../store/settings";
import { useUiStore } from "../store/ui";
import AddCellRow from "./AddCellRow.vue";
import CellCard from "./CellCard.vue";
import MarkdownBlock from "./MarkdownBlock.vue";
import MarkdownCard from "./MarkdownCard.vue";
import { cellEvents } from "./cellEvents";
import { showsValues, useScopes } from "./lineValues";
import type { NamedValue } from "../editor/lineValues";
import type { CellModel } from "./models";
import { cellLabel } from "./models";
import { outputHostKey } from "./outputHost";
import { useAgentEdits } from "./useAgentEdits";
import { useCellDrag } from "./useCellDrag";
import { useCells } from "./useCells";
import { blockEnd } from "../store/sections";
import { useDrafts } from "./useDrafts";
import { useFocusFollow } from "./useFocusFollow";
import { useLanguage } from "./useLanguage";
import { useValues } from "./useValues";

const dispatcher = useDispatcher();
const store = useNotebookStore();
const ui = useUiStore();
const host = inject(outputHostKey, {
  engines: undefined,
  fetchFullValue: (url: string, signal: AbortSignal) =>
    fetch(url, { signal }).then((r) => r.blob()),
  tabUrl: () => "",
});
const stores = { store, ui, settings: useSettingsStore(), containers: useContainersStore() };
const { cells, page, stateOf, off } = useCells(stores, host, isMac(navigator.userAgent));
const drafts = useDrafts(store, ui);
useLanguage({ ...stores, dispatcher, off: () => off.value });
const values = useValues(store);
useAgentEdits(store, ui);

const shown = computed(() =>
  ui.filter === "agentEdits"
    ? cells.value.filter((cell) => store.byId.get(cell.id)?.meta.lastEdit?.review !== undefined)
    : cells.value.filter((cell) => !store.sections.hiddenBy.has(cell.id)),
);
/** The cells a collapsed heading's section holds, for its "n cells hidden" row. */
const hiddenCount = (cell: CellId) =>
  store.byId.get(cell)?.meta.headingCollapsed === true
    ? (store.sections.heads.get(cell)?.size ?? 0)
    : 0;
/** A cell added after a shown one goes after its block: a collapsed heading's after its section. */
const addAfter = (type: CellType, after: CellId | undefined) => {
  add(type, after === undefined ? after : blockEnd(store.cellsInOrder, store.sections, after));
};
const tabStop = computed(
  () => shown.value.find((cell) => cell.id === ui.selected)?.id ?? shown.value[0]?.id ?? null,
);
// Side effect: a filter that hides the selected cell moves the selection to the first cell it shows (or none), so no
// key acts on a cell the user cannot see; a deleted cell's neighbour is useFocusFollow's.
watch(
  () => shown.value.map((cell) => cell.id),
  (ids) => {
    const hidden =
      ui.selected !== null &&
      store.byId.has(ui.selected) &&
      !ids.includes(ui.selected) &&
      !store.sections.hiddenBy.has(ui.selected);
    if (hidden) ui.select(ids[0] ?? null);
  },
);
// Side effect: the selected cell inside a collapsed section. A heading just collapsed over it (here, by Left, or by an
// agent) moves the selection to the outermost such heading, as Jupyter does; a cell selected or moved into a collapsed
// section (the outline, a diagnostic, ⌥↓ past a collapsed heading) opens the sections that hide it, when this tab may
// write, else the selection moves to the heading.
watch(
  () => {
    const hiding = ui.selected === null ? [] : (store.sections.hiddenBy.get(ui.selected) ?? []);
    const collapsed = store.cellsInOrder.filter((cell) => cell.meta.headingCollapsed === true);
    return { selected: ui.selected, hiding, collapsed: collapsed.map((cell) => cell.id) };
  },
  (now, before) => {
    const [outer] = now.hiding;
    if (outer === undefined) return;
    const fresh = now.hiding.some((head) => !before.collapsed.includes(head));
    if (fresh || off.value) {
      ui.select(outer);
      return;
    }
    for (const head of now.hiding) void store.update(head, { meta: { headingCollapsed: false } });
  },
);
// Side effect: a pinned cell that is deleted takes its pin with it.
watch(
  () => ui.pinned !== null && !store.byId.has(ui.pinned),
  (gone) => {
    if (gone) ui.togglePin(null);
  },
);
const valuesOf = (cell: CellId, meta: CellMeta) =>
  meta.showBindings === true ? (values.value.get(cell) ?? null) : undefined;

const lineValuesOn = () => stores.settings.valueOf("editor.lineValues") !== false;
const scopes = useScopes(store, lineValuesOn);
const none: ReadonlyMap<string, NamedValue> = new Map();
/** The values a server cell's lines may show while the setting is on, its text is what ran and its run ended well. */
const lineValues = (cell: CellModel) =>
  lineValuesOn() && showsValues(cell, cell.editedSince || ui.draftOf(cell.id) !== undefined)
    ? scopes.value
    : none;
const on = (cell: CellId) => cellEvents(cell, { dispatcher, ui, drafts });
const list = ref<HTMLElement | null>(null);
const { point, edit, add } = useFocusFollow(store, ui, list);
const drag = useCellDrag(
  store,
  () => shown.value.map((cell) => cell.id),
  () => off.value || ui.filter === "agentEdits",
);
/** A press on a cell's number may start a drag (useCellDrag); anywhere else it only selects. */
function press(cell: CellId, event: PointerEvent): void {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('[data-part="number"]') != null) drag.press(cell, event);
}
/** The drop line before `cell` (null: after the last cell) while a drag would land there. */
const lineBefore = (cell: CellId | null) =>
  drag.dragging.value !== null && drag.drop.value?.before === cell;
</script>

<template>
  <ol
    ref="list"
    aria-label="Cells"
    class="ui:m-0 ui:flex ui:list-none ui:flex-col ui:p-0 ui:ps-(--cell-margin) ui:pe-2"
    data-testid="cell-list"
  >
    <template v-for="(cell, at) in shown" :key="cell.id">
      <li
        :data-cell="cell.id"
        :aria-label="cellLabel(cell)"
        :tabindex="tabStop === cell.id ? 0 : -1"
        :data-selected="cell.selected ? '' : undefined"
        :data-dragged="drag.dragging.value === cell.id ? '' : undefined"
        class="ui:group/item ui:relative ui:rounded-none ui:focus-visible:shadow-none ui:data-dragged:opacity-40"
        @mousedown="point(cell.id)"
        @pointerdown="(event: PointerEvent) => press(cell.id, event)"
      >
        <div
          v-if="lineBefore(cell.id)"
          data-part="drop-line"
          aria-hidden="true"
          class="ui:pointer-events-none ui:absolute ui:inset-x-0 ui:inset-bs-0 ui:z-(--z-toolbar) ui:bg-accent ui:block-0.5"
        />
        <AddCellRow
          v-if="at > 0"
          place="gap"
          :off="off"
          :tight="cell.folded && shown[at - 1]?.folded === true"
          @add="(type) => addAfter(type, shown[at - 1]?.id)"
        />
        <MarkdownCard
          v-if="cell.type === 'markdown' && cell.editing"
          :cell="cell"
          :page="page"
          :state="stateOf(cell, undefined)"
          v-on="on(cell.id)"
        />
        <MarkdownBlock
          v-else-if="cell.type === 'markdown'"
          :cell="cell"
          :source="ui.draftOf(cell.id) ?? cell.source"
          :page="page"
          :menu="stateOf(cell, undefined).menu"
          :section="store.sections.heads.has(cell.id)"
          :hidden="hiddenCount(cell.id)"
          @edit="edit(cell.id)"
          @command="on(cell.id).command"
        />
        <CellCard
          v-else
          :cell="cell"
          :page="page"
          :state="stateOf(cell, valuesOf(cell.id, cell.meta))"
          :line-values="lineValues(cell)"
          v-on="on(cell.id)"
        />
      </li>
    </template>
    <li
      v-if="lineBefore(null)"
      data-part="drop-line"
      aria-hidden="true"
      class="ui:pointer-events-none ui:mbs-1 ui:bg-accent ui:block-0.5"
    />
  </ol>
  <AddCellRow place="last" :off="off" @add="(type) => addAfter(type, shown.at(-1)?.id)" />
</template>
