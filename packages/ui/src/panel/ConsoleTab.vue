<!-- ConsoleTab: the bottom panel's Console (store/consoleLog.ts): every line the cells printed, on the server and in the page, one row per line under a column header: the time, the level in words (output, error output, uncaught), where it ran (server or page), the cell it came from (a button that goes to it) and the text in the mono font. Above them a filter field, the three level switches (square, pressed when shown) and Clear; the newest line stays in view while the list is at its end. -->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";

import { useDispatcher } from "../commands/dispatch";
import type { ConsoleLevel } from "../store/consoleLog";
import { useConsoleStore } from "../store/consoleLog";
import { useNotebookStore } from "../store/notebook";
import { timeOf } from "./activityLines";
import { note, wordButton } from "./rows";

const log = useConsoleStore();
const store = useNotebookStore();
const dispatcher = useDispatcher();
const filter = ref("");
const levels = ref<ReadonlySet<ConsoleLevel>>(new Set(["output", "error output", "uncaught"]));
const switches: readonly {
  readonly level: ConsoleLevel;
  readonly words: string;
  readonly tip: string;
}[] = [
  {
    level: "output",
    words: "Output",
    tip: "What the cells printed to standard output (console.log)",
  },
  {
    level: "error output",
    words: "Error output",
    tip: "What they printed to standard error (console.error, console.warn)",
  },
  {
    level: "uncaught",
    words: "Uncaught",
    tip: "Errors thrown after a run ended (a handler, a timer)",
  },
];
function toggle(level: ConsoleLevel): void {
  const next = new Set(levels.value);
  if (next.has(level)) next.delete(level);
  else next.add(level);
  levels.value = next;
}
const numbers = computed(() => new Map(store.cellsInOrder.map((cell, at) => [cell.id, at + 1])));
const shown = computed(() => {
  const words = filter.value.trim().toLowerCase();
  return log.lines
    .filter((line) => levels.value.has(line.level))
    .filter((line) => words === "" || line.text.toLowerCase().includes(words))
    .map((line) => ({
      ...line,
      time: timeOf(line.at),
      number: numbers.value.get(line.cell) ?? null,
      realm: store.byId.get(line.cell)?.type === "client" ? "page" : "server",
    }));
});
const levelTone: Readonly<Record<ConsoleLevel, string>> = {
  output: "ui:text-muted",
  "error output": "ui:text-fg-2",
  uncaught: "ui:text-err",
};
const grid =
  "ui:grid ui:grid-cols-[6.5rem_5.5rem_3.5rem_3.5rem_minmax(0,1fr)] ui:gap-3 ui:items-baseline ui:px-1";
const box = ref<HTMLElement | null>(null);
// Side effect: the tab opens on its newest rows.
onMounted(() => box.value?.scrollTo({ top: box.value.scrollHeight }));
// Side effect: a new line scrolls into view while the list was at its end.
watch(
  () => shown.value.length,
  async () => {
    const element = box.value;
    const atEnd =
      element === null || element.scrollHeight - element.scrollTop - element.clientHeight < 32;
    await nextTick();
    if (atEnd) box.value?.scrollTo({ top: box.value.scrollHeight });
  },
);
const switchClass =
  "ui:inline-flex ui:cursor-pointer ui:items-center ui:rounded-none ui:border ui:border-transparent ui:bg-transparent ui:px-1.5 ui:text-tiny ui:text-muted ui:block-5.5 ui:hover:text-fg ui:focus-visible:border-accent ui:aria-pressed:bg-sheet ui:aria-pressed:font-medium ui:aria-pressed:text-fg";
</script>

<template>
  <div class="ui:flex ui:flex-1 ui:flex-col ui:gap-1 ui:min-block-0">
    <div class="ui:flex ui:items-center ui:gap-2 ui:px-1 ui:min-inline-0">
      <input
        v-model="filter"
        type="search"
        aria-label="Filter the lines"
        placeholder="Filter"
        data-testid="console-filter"
        class="ui:rounded-none ui:border ui:border-transparent ui:bg-sheet ui:px-2 ui:text-tiny ui:text-fg ui:block-5.5 ui:inline-[min(16rem,40%)] ui:placeholder:text-muted ui:focus-visible:border-accent"
      />
      <span role="group" aria-label="Levels shown" class="ui:flex ui:items-center ui:gap-0.5">
        <button
          v-for="each in switches"
          :key="each.level"
          type="button"
          :title="each.tip"
          :aria-pressed="levels.has(each.level)"
          :class="switchClass"
          @click="toggle(each.level)"
        >
          {{ each.words }}
        </button>
      </span>
      <span class="ui:ms-auto ui:text-tiny ui:text-muted"
        >{{ shown.length }} of {{ log.lines.length }}</span
      >
      <button
        type="button"
        :class="wordButton"
        :disabled="log.lines.length === 0"
        @click="log.clear"
      >
        Clear
      </button>
    </div>
    <div role="row" :class="[grid, 'ui:shrink-0 ui:text-tiny ui:text-muted ui:block-5']">
      <span role="columnheader">Time</span>
      <span role="columnheader">Level</span>
      <span role="columnheader">Ran in</span>
      <span role="columnheader">Cell</span>
      <span role="columnheader">Text</span>
    </div>
    <p v-if="log.lines.length > 0 && shown.length === 0" :class="note">No results</p>
    <div
      v-else
      ref="box"
      role="rowgroup"
      tabindex="0"
      aria-label="Console lines"
      data-testid="console-lines"
      class="ui:flex ui:flex-1 ui:flex-col ui:overflow-y-auto ui:min-block-0"
    >
      <div
        v-for="line in shown"
        :key="line.key"
        role="row"
        :class="[grid, 'ui:shrink-0 ui:py-0.5 ui:text-[0.71875rem] ui:leading-[1.3rem]']"
      >
        <span
          class="ui:font-mono ui:whitespace-nowrap ui:text-fg-2 ui:tabular-nums"
          :title="
            line.arrived ? undefined : 'The run\'s start: the line was there when the page loaded'
          "
          >{{ line.time }}</span
        >
        <span :class="['ui:text-tiny', levelTone[line.level]]">{{ line.level }}</span>
        <span class="ui:text-tiny ui:text-muted">{{ line.realm }}</span>
        <span class="ui:text-tiny">
          <button
            v-if="line.number !== null"
            type="button"
            class="ui:cursor-pointer ui:rounded-none ui:border ui:border-transparent ui:bg-transparent ui:p-0 ui:font-inherit ui:text-fg-2 ui:hover:text-fg ui:hover:underline ui:focus-visible:border-accent"
            :aria-label="`Go to cell ${String(line.number)}`"
            @click="dispatcher.dispatch('ui.select', { cell: line.cell })"
          >
            cell {{ line.number }}
          </button>
          <template v-else>deleted</template>
        </span>
        <span class="ui:font-mono ui:break-all ui:whitespace-pre-wrap ui:text-fg">{{
          line.text
        }}</span>
      </div>
    </div>
  </div>
</template>
