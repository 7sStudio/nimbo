<!-- ActivityTab: the bottom panel's Activity tab (store/activity.ts): one row per cell run, bridge call and route request this page knows of, under a column header: Time, Kind, What, From, To (a cell is a button that goes to it), Result and Duration, oldest first and the newest in view. From and To in words: "you" to "server, cell 2", "page" to "server, cell 3", "curl 127.0.0.1" to "server, cell 4". A run's duration is the kernel's or the page's, a request's the kernel's around its handler, a call's how long the page waited. -->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";

import { useCellNames } from "../cells/names";
import { useDispatcher } from "../commands/dispatch";
import { useActivityStore } from "../store/activity";
import { useNotebookStore } from "../store/notebook";
import type { Tone } from "./activityLines";
import { lineOf } from "./activityLines";
import { bridgeOf } from "./bridge";

const activity = useActivityStore();
const store = useNotebookStore();
const dispatcher = useDispatcher();
const names = useCellNames();
const numbers = computed(() => new Map(store.cellsInOrder.map((cell, at) => [cell.id, at + 1])));
const exporters = computed(
  () =>
    new Map(bridgeOf(store.cellsInOrder, store.mirror.graph).map((each) => [each.name, each.cell])),
);

const lines = computed(() =>
  activity.rows.map((row) =>
    lineOf(row, {
      nameOf: (cell) => names.value.get(cell) ?? "",
      whereOf: (cell) => {
        const realm = store.byId.get(cell)?.type === "client" ? "page" : "server";
        const number = numbers.value.get(cell);
        return number === undefined
          ? `${realm}, a deleted cell`
          : `${realm}, cell ${String(number)}`;
      },
      exporterOf: (fn) => exporters.value.get(fn)?.id,
    }),
  ),
);
const tones: Readonly<Record<Tone, string>> = {
  ok: "ui:text-ok",
  err: "ui:text-err",
  muted: "ui:text-muted",
};
const grid =
  "ui:grid ui:grid-cols-[6.5rem_5.75rem_minmax(9rem,2fr)_minmax(6rem,1fr)_minmax(6rem,1fr)_5.25rem_5.75rem] ui:gap-3 ui:items-center ui:px-1";
const box = ref<HTMLElement | null>(null);
// Side effect: the tab opens on its newest rows.
onMounted(() => box.value?.scrollTo({ top: box.value.scrollHeight }));
// Side effect: a new row scrolls into view while the list was at its end (a user reading back keeps their place).
watch(
  () => lines.value.length,
  async () => {
    const element = box.value;
    const atEnd =
      element === null || element.scrollHeight - element.scrollTop - element.clientHeight < 32;
    await nextTick();
    if (atEnd) box.value?.scrollTo({ top: box.value.scrollHeight });
  },
);
</script>

<template>
  <div class="ui:flex ui:flex-1 ui:flex-col ui:min-block-0">
    <div
      role="row"
      :class="[grid, 'ui:shrink-0 ui:text-tiny ui:text-muted ui:block-5']"
      data-testid="activity-head"
    >
      <span role="columnheader">Time</span>
      <span role="columnheader">Kind</span>
      <span role="columnheader">What</span>
      <span role="columnheader">From</span>
      <span role="columnheader">To</span>
      <span role="columnheader">Result</span>
      <span role="columnheader" class="ui:text-end">Duration</span>
    </div>
    <div
      ref="box"
      role="rowgroup"
      tabindex="0"
      aria-label="Activity"
      class="ui:flex ui:flex-1 ui:flex-col ui:overflow-y-auto ui:min-block-0"
    >
      <div
        v-for="line in lines"
        :key="line.key"
        role="row"
        :class="[grid, 'ui:shrink-0 ui:font-mono ui:text-[0.71875rem] ui:text-fg-2 ui:block-5.75']"
      >
        <span class="ui:whitespace-nowrap ui:tabular-nums">{{ line.time }}</span>
        <span class="ui:font-sans ui:text-tiny ui:whitespace-nowrap ui:text-muted">{{
          line.kind
        }}</span>
        <span
          class="ui:ellipsis ui:text-fg ui:min-inline-0"
          :title="line.detail === '' ? line.what : `${line.what}: ${line.detail}`"
          >{{ line.what
          }}<span v-if="line.detail !== ''" class="ui:ps-2 ui:text-muted">{{
            line.detail
          }}</span></span
        >
        <span class="ui:ellipsis ui:font-sans ui:text-tiny ui:min-inline-0" :title="line.from">{{
          line.from
        }}</span>
        <span class="ui:ellipsis ui:font-sans ui:text-tiny ui:min-inline-0">
          <button
            v-if="line.to.cell !== null"
            type="button"
            class="ui:cursor-pointer ui:rounded-none ui:border ui:border-transparent ui:bg-transparent ui:p-0 ui:font-inherit ui:text-fg-2 ui:hover:text-fg ui:hover:underline ui:focus-visible:border-accent"
            :aria-label="`${line.to.words}: go to the cell`"
            @click="dispatcher.dispatch('ui.select', { cell: line.to.cell })"
          >
            {{ line.to.words }}
          </button>
          <template v-else>{{ line.to.words }}</template>
        </span>
        <span :class="['ui:whitespace-nowrap', tones[line.tone]]">{{ line.result }}</span>
        <span class="ui:text-end ui:whitespace-nowrap ui:tabular-nums">{{ line.took }}</span>
      </div>
    </div>
  </div>
</template>
