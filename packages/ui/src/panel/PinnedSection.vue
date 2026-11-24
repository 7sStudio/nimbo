<!-- PinnedSection: the inspector's first group while a result is pinned (P, Pin to inspector): "Pinned result" with the cell it came from and Unpin, then that cell's result, live (a client cell's elements move here, since the page holds them once), on a tone darker than the inspector so it reads as lifted out of the notebook. It stays in view while the notebook scrolls; Unpin sends it back under its cell. -->
<script setup lang="ts">
import { Pin } from "@lucide/vue";
import { computed, inject, nextTick, ref, watch } from "vue";

import CellResult from "../cells/CellResult.vue";
import { outputHostKey } from "../cells/outputHost";
import { useCells } from "../cells/useCells";
import { useDispatcher } from "../commands/dispatch";
import { isMac } from "../keyboard/modes";
import { copyText } from "../store/clipboard";
import { useContainersStore } from "../store/containers";
import { useNotebookStore } from "../store/notebook";
import { useSettingsStore } from "../store/settings";
import { useUiStore } from "../store/ui";
import { note, wordButton } from "./rows";

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
const { cells, page, stateOf } = useCells(stores, host, isMac(navigator.userAgent));
const cell = computed(() => cells.value.find((each) => each.id === ui.pinned));
/** The pinned result in the inspector takes the page's own cap, not the seven lines of the notebook. */
const inspectorPage = computed(() => ({
  ...page.value,
  maxHeight: page.value.sevenLines ? 400 : page.value.maxHeight,
}));

const section = ref<HTMLElement | null>(null);
// Side effect: a result pinned while the inspector shows comes into view at its top; the focus stays where it was.
watch(
  () => ui.pinned,
  async (pinned) => {
    if (pinned === null) return;
    await nextTick();
    section.value?.scrollIntoView({ block: "nearest" });
  },
);
const run = (id: string, args?: Record<string, unknown>) => {
  if (cell.value !== undefined) ui.select(cell.value.id);
  void dispatcher.dispatch(id, args);
};
</script>

<template>
  <section
    v-if="cell !== undefined"
    ref="section"
    aria-labelledby="section-pinned"
    data-section="pinned"
    class="ui:-mx-2 ui:mbe-3 ui:flex ui:flex-col ui:gap-1.5 ui:bg-head-focus ui:px-2 ui:pbe-2.5 ui:min-inline-0"
  >
    <div class="ui:flex ui:items-center ui:gap-1.5 ui:whitespace-nowrap ui:block-7 ui:min-inline-0">
      <Pin class="ui:shrink-0 ui:text-fg ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
      <h3
        id="section-pinned"
        class="ui:tracking-wide ui:m-0 ui:text-tiny ui:font-semibold ui:text-fg-2 ui:uppercase"
      >
        Pinned
      </h3>
      <span class="ui:flex-1 ui:ellipsis ui:text-tiny ui:text-fg-2 ui:min-inline-0"
        >cell {{ cell.number }}, {{ cell.name }}</span
      >
      <button
        type="button"
        :class="[wordButton, 'ui:bg-sheet ui:px-2 ui:hover:bg-well']"
        @click="run('ui.unpin')"
      >
        Unpin
      </button>
    </div>
    <CellResult
      v-if="stateOf(cell, undefined).outputs.length > 0"
      :cell="cell"
      :page="inspectorPage"
      :state="stateOf(cell, undefined)"
      place="inspector"
      @command="run"
      @meta="(patch) => run('cell.update', { cell: cell?.id, meta: patch })"
      @copy="(event) => ui.toast({ kind: 'success', title: `Copied ${event.what}` })"
      @copy-text="(text, what) => void copyText(ui, text, what)"
      @jump="(target) => run('ui.select', { cell: target.cell })"
    />
    <p v-else :class="[note, 'ui:text-fg-2']">No result</p>
  </section>
</template>
