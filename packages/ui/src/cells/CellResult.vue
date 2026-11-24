<!-- CellResult: a cell's result where it shows, under its cell or in the inspector's Pinned result group: its outputs (CellOutputs) and, under a cell, the footer of a long one (ResultFooter: which lines are in view, Pin to inspector, Expand or the cap again, Fold). A result pinned to the inspector leaves one row in its place under the cell, saying so, with Show in inspector and "Unpin, show here"; a client cell's live elements then live in the inspector, since one page holds them once. It reports the lines in view to its card, whose header says them while it stays at the top. -->
<script setup lang="ts">
import type { MetaPatch } from "./card";
import type { CopyEvent, JumpTarget, LoadMoreRequest } from "@jsnb/output-view";
import { computed, ref, watch } from "vue";

import { wordButton } from "../panel/rows";
import type { CardPage, CardState } from "./card";
import CellOutputs from "./CellOutputs.vue";
import type { CellModel } from "./models";
import ResultFooter from "./ResultFooter.vue";
import type { Lines } from "./resultLines";
import { capLines, useResultLines } from "./resultLines";

const props = withDefaults(
  defineProps<{
    cell: CellModel;
    page: CardPage;
    state: CardState;
    place?: "cell" | "inspector";
  }>(),
  { place: "cell" },
);
const emit = defineEmits<{
  command: [id: string, args?: Record<string, unknown>];
  meta: [patch: MetaPatch];
  copy: [event: CopyEvent];
  jump: [target: JumpTarget];
  handled: [];
  copyText: [text: string, what: string];
  lines: [lines: Lines | null];
}>();

const outputs = ref<InstanceType<typeof CellOutputs> | null>(null);
const root = computed(() => {
  const list: unknown = outputs.value?.list;
  return list instanceof HTMLElement ? list : null;
});
const lines = useResultLines(root);
// Side effect: the card hears which lines are in view, for its header while it stays at the top.
watch(lines, (now) => {
  emit("lines", now);
});
const pinnedHere = computed(() => props.place === "cell" && props.cell.pinned);
const expanded = computed(() => props.cell.meta.outputHeight === "fit");
/** The footer shows under a long result: one the cap cuts, or one expanded past seven lines. */
const footer = computed(() => {
  const now = lines.value;
  if (props.place !== "cell" || now === null) return null;
  return (expanded.value ? now.total > capLines : now.cut) ? now : null;
});
const loadMore = (index: number, request: LoadMoreRequest, signal: AbortSignal) =>
  props.page.loadMore(props.cell.id, index, request, signal);
const functionSource = (name: string) => props.page.functionSource(props.cell.id, name);
</script>

<template>
  <div
    v-if="pinnedHere"
    data-part="pinned-here"
    class="ui:flex ui:items-center ui:gap-4 ui:bg-result ui:py-1.5 ui:ps-(--cell-inset) ui:pe-4 ui:text-tiny ui:text-muted"
  >
    <span class="ui:ellipsis ui:min-inline-0">Result pinned to the inspector</span>
    <span class="ui:ms-auto ui:flex ui:shrink-0 ui:items-center ui:gap-2">
      <button
        type="button"
        :class="[wordButton, 'ui:bg-sheet ui:px-2 ui:hover:bg-well']"
        @click="emit('command', 'ui.panel.open', { which: 'pinned' })"
      >
        Show in inspector
      </button>
      <button type="button" :class="wordButton" @click="emit('command', 'ui.cell.pin')">
        Unpin, show here
      </button>
    </span>
  </div>
  <CellOutputs
    v-else
    ref="outputs"
    :outputs="props.state.outputs"
    :execution="props.state.execution"
    :meta="props.cell.meta"
    :max-height="props.page.maxHeight"
    :running="props.cell.status === 'running'"
    :host="props.page.host"
    :mac="props.page.mac"
    :live="props.state.live"
    :request="props.place === 'cell' ? props.state.request : null"
    :load-more="loadMore"
    :function-source="functionSource"
    :routes="props.state.routes"
    :source="props.cell.source"
    :place="props.place"
    @meta="(patch) => emit('meta', patch)"
    @copy="(event) => emit('copy', event)"
    @jump="(target) => emit('jump', target)"
    @handled="emit('handled')"
    @copy-text="(text, what) => emit('copyText', text, what)"
  >
    <template v-if="footer !== null" #footer>
      <ResultFooter
        :lines="footer"
        :expanded="expanded"
        :seven-lines="props.page.sevenLines"
        :mac="props.page.mac"
        @command="(id, args) => emit('command', id, args)"
      />
    </template>
  </CellOutputs>
</template>
