<!-- BridgeSection: the inspector's Bridge group: the functions server cells export for client cells to call, then the events server cells emit (bridge.events: per name the count, the last time and how many were dropped and why), read again a second after an event output reaches a client cell. Each export has its name and the cell that exports it (a click goes to it), its TypeScript signature in syntax colours as the hover shows it (notebook.bridge; the parameters as the cell writes them while the language service has none), wrapped to three lines and opened whole with its documentation from a click, the client cells that call it (each a link), and the last call this page made, when it was and how it ended (the Activity log's row). -->
<script setup lang="ts">
import type { BridgeExport as Remote } from "@jsnb/core";
import { computed, onBeforeUnmount, shallowRef, watch } from "vue";

import { useDispatcher } from "../commands/dispatch";
import { durationText } from "../cells/runWords";
import { codeLine } from "../editor/language/popups";
import { useActivityStore } from "../store/activity";
import { useNotebookStore } from "../store/notebook";
import { useUiStore } from "../store/ui";
import { timeOf } from "./activityLines";
import Section from "./Section.vue";
import { bridgeOf, compactSignature, signatureTail } from "./bridge";
import { wordButton } from "./rows";

const dispatcher = useDispatcher();
/** The info icon's popover: what the group lists and what its rows say. */
const info = [
  "Functions server cells export. Client cells call them like local functions; they run in Node and return the result.",
  "Callers: client cells that use it. Last call: this page's latest call.",
  "Events: what server cells emit(name, data) to client cells' on(name, callback).",
];
const store = useNotebookStore();
const ui = useUiStore();
const exports = computed(() => bridgeOf(store.cellsInOrder, store.mirror.graph));
const numbers = computed(() => new Map(store.cellsInOrder.map((cell, at) => [cell.id, at + 1])));
const go = (cell: string) => void dispatcher.dispatch("ui.select", { cell });

/** TypeScript's view of each export by name, from notebook.bridge; empty until it answers. */
const remote = shallowRef<ReadonlyMap<string, Remote>>(new Map());
let timer: ReturnType<typeof setTimeout> | undefined;
const read = async () => {
  const answer = await store.bridge();
  if (answer !== null) remote.value = new Map(answer.map((each) => [each.name, each]));
};
// Side effect: the signatures are read once the notebook is here and again a moment after a server cell's code changes.
watch(
  () =>
    store.started && store.mirror.notebook !== null
      ? store.cellsInOrder
          .filter((cell) => cell.type === "server")
          .map((cell) => cell.source)
          .join("\u0000")
      : null,
  (key) => {
    clearTimeout(timer);
    if (key !== null) timer = setTimeout(() => void read(), 400);
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  clearTimeout(timer);
});

type Row = {
  readonly name: string;
  readonly cell: { readonly id: string; readonly number: number };
  readonly callers: readonly string[];
  /** The whole signature as the hover shows it: `function summarize(todos: …): Promise<…>`. */
  readonly full: string;
  /** On one line, without the keyword and the name: `(todos: …): Promise<…>`. */
  readonly short: string;
  readonly documentation: string;
};
/** The source's parameters as a declaration: `async (a, b)` is `async function name(a, b)`. */
const fromSource = (name: string, signature: string): string =>
  signature === "" ? "" : signature.replace(/^(async )?/u, `$1function ${name}`);
const rows = computed((): readonly Row[] =>
  exports.value.map((each) => {
    const typed = remote.value.get(each.name);
    const full = typed?.signature ?? fromSource(each.name, each.signature);
    return {
      name: each.name,
      cell: each.cell,
      callers: typed?.callers ?? each.callers.map((n) => store.cellsInOrder[n - 1]?.id ?? ""),
      full,
      short: compactSignature(signatureTail(full, each.name)),
      documentation: typed?.documentation ?? "",
    };
  }),
);
/** The short signature's spans, coloured by the active syntax theme. */
const html = (text: string) => codeLine(text).innerHTML;

/** The export in full in the hint dialog: the signature as the hover lays it out, then its documentation. */
async function expand(row: Row): Promise<void> {
  const { renderMarkdown } = await import("../editor/render");
  const code = codeLine(row.full).outerHTML;
  const docs = row.documentation.trim() === "" ? "" : renderMarkdown(row.documentation);
  ui.overlay = { kind: "hint", title: row.name, html: `${code}${docs}` };
}

type EventRow = Awaited<ReturnType<typeof store.bridgeEvents>>;
const events = shallowRef<NonNullable<EventRow>>([]);
let eventsTimer: ReturnType<typeof setTimeout> | undefined;
const readEvents = async () => {
  eventsTimer = undefined;
  const answer = await store.bridgeEvents();
  if (answer !== null) events.value = answer;
};
const dropWords = { noPage: "no page", noListener: "no listener", overflow: "too fast" } as const;
/** "28 · 23:14:58"; the drops go on a line of their own. */
const countLine = (row: NonNullable<EventRow>[number]): string =>
  `${String(row.emitted)} · ${timeOf(row.lastAt).slice(0, 8)}`;
const dropLine = (row: NonNullable<EventRow>[number]): string =>
  row.dropped === 0 || row.lastDrop === null
    ? ""
    : `${String(row.dropped)} dropped, last: ${dropWords[row.lastDrop]}`;
// Side effect: the counts are read once the notebook is here, then a second after a client cell gets an event output.
watch(
  () =>
    store.started && store.mirror.notebook !== null
      ? store.cellsInOrder
          .filter((cell) => cell.type === "client")
          .map((cell) => {
            const outputs = store.lastExecutionOf(cell.id)?.outputs ?? [];
            return outputs.filter((output) => output.kind === "event").length;
          })
          .join(",")
      : null,
  (key) => {
    if (key !== null && eventsTimer === undefined)
      eventsTimer = setTimeout(() => void readEvents(), 1000);
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  clearTimeout(eventsTimer);
});

const activity = useActivityStore();
/** "14:01:10, ok in 3.1 ms", or the failure; none before this page made a call. */
const lastCalls = computed(() => {
  const last = new Map<string, string>();
  for (const row of activity.rows) {
    if (row.kind !== "bridge") continue;
    const when = timeOf(row.at).slice(0, 8);
    const how =
      row.ok === null
        ? "waiting"
        : row.ok
          ? `ok in ${row.ms === null ? "" : durationText(row.ms)}`
          : `failed, ${row.error}`;
    last.set(row.fn, `${when}, ${how}`);
  }
  return last;
});
</script>

<template>
  <Section name="bridge" title="Bridge" :info="info" :count="rows.length + events.length">
    <ul
      v-if="rows.length > 0"
      aria-label="Exports"
      class="ui:m-0 ui:flex ui:list-none ui:flex-col ui:gap-1 ui:p-0"
    >
      <li v-for="each in rows" :key="each.name" class="ui:flex ui:flex-col ui:pbe-1">
        <div class="ui:flex ui:items-center ui:gap-2 ui:px-1.75 ui:block-6">
          <span
            class="ui:flex-1 ui:ellipsis ui:font-mono ui:text-[0.71875rem] ui:text-(--fn) ui:min-inline-0"
            data-part="name"
            >{{ each.name }}</span
          >
          <button
            type="button"
            :class="[wordButton, 'ui:font-normal ui:text-muted']"
            :title="`Go to cell ${String(each.cell.number)}`"
            :aria-label="`Go to cell ${String(each.cell.number)}`"
            @click="go(each.cell.id)"
          >
            cell {{ each.cell.number }}
          </button>
        </div>
        <!-- eslint-disable vue/no-v-html -- codeLine's spans: the signature's text set as textContent, coloured inline -->
        <button
          v-if="each.short !== ''"
          type="button"
          class="ui:leading-snug ui:mx-1 ui:[display:-webkit-box] ui:cursor-pointer ui:overflow-clip ui:rounded-control ui:border ui:border-transparent ui:bg-transparent ui:px-0.75 ui:py-0.5 ui:text-start ui:font-mono ui:text-tiny ui:break-words ui:text-fg-2 ui:[-webkit-box-orient:vertical] ui:[-webkit-line-clamp:3] ui:hover:bg-sheet ui:focus-visible:border-accent"
          data-part="signature"
          :title="each.full"
          @click="expand(each)"
          v-html="html(each.short)"
        />
        <!-- eslint-enable vue/no-v-html -->
        <p
          class="ui:m-0 ui:grid ui:grid-cols-[4.5rem_minmax(0,1fr)] ui:items-center ui:gap-x-2 ui:px-1.75 ui:text-tiny"
        >
          <span class="ui:text-muted">Callers</span>
          <span class="ui:flex ui:flex-wrap ui:gap-x-1 ui:min-inline-0" data-part="callers">
            <span v-if="each.callers.length === 0" class="ui:text-muted">none</span>
            <button
              v-for="caller in each.callers"
              :key="caller"
              type="button"
              :class="[wordButton, 'ui:-ms-1 ui:font-normal ui:block-5']"
              :aria-label="`Go to cell ${String(numbers.get(caller) ?? '')}`"
              @click="go(caller)"
            >
              cell {{ numbers.get(caller) ?? "?" }}
            </button>
          </span>
          <span class="ui:text-muted">Last call</span>
          <span
            :class="[
              'ui:ellipsis',
              lastCalls.has(each.name) ? 'ui:font-mono ui:text-fg' : 'ui:text-muted',
            ]"
            data-part="last-call"
            :title="lastCalls.get(each.name) ?? 'No call from this page yet'"
            >{{ lastCalls.get(each.name) ?? "none" }}</span
          >
        </p>
      </li>
    </ul>
    <ul
      v-if="events.length > 0"
      aria-label="Events"
      class="ui:m-0 ui:mbs-2 ui:flex ui:list-none ui:flex-col ui:gap-1 ui:p-0"
    >
      <li v-for="row in events" :key="row.name" class="ui:flex ui:flex-col ui:px-1.75 ui:text-tiny">
        <span class="ui:flex ui:items-center ui:gap-2">
          <span
            class="ui:flex-1 ui:ellipsis ui:font-mono ui:text-fg ui:min-inline-0"
            data-part="event"
            :title="row.name"
            >{{ row.name }}</span
          >
          <span
            class="ui:shrink-0 ui:font-mono ui:text-muted"
            data-part="event-counts"
            :title="`${String(row.delivered)} delivered`"
            >{{ countLine(row) }}</span
          >
        </span>
        <span v-if="dropLine(row) !== ''" class="ui:text-muted" data-part="event-drops">{{
          dropLine(row)
        }}</span>
      </li>
    </ul>
  </Section>
</template>
