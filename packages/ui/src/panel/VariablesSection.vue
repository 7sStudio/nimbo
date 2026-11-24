<!-- VariablesSection: the inspector's Variables group: everything defined in the server kernel or in the page, with its value and the cell that defined it. A Server / Client switch, a filter, rows name, value and cell from kernel.scope under one column header (an exported name says so in words; a client name a server cell also exports says it shadows that export, 05-bridge §3.3, since the page's own is the one in effect there); a row click expands it with an OutputView of the full value, read through cell.bindings of the cell that defined it. -->
<script setup lang="ts">
import type { Binding, BindingValue } from "@jsnb/core";
import { OutputView } from "@jsnb/output-view";
import { Search } from "@lucide/vue";
import { computed, nextTick, ref, shallowRef, watch } from "vue";

import Segmented from "../primitives/segmented/Segmented.vue";
import SegmentedItem from "../primitives/segmented/SegmentedItem.vue";
import TextInput from "../primitives/text-input/TextInput.vue";
import { useNotebookStore } from "../store/notebook";
import { useUiStore } from "../store/ui";
import { exportersOf } from "./exporters";
import Section from "./Section.vue";
import { note } from "./rows";
import type { Realm } from "./useScope";
import { useScope } from "./useScope";

const store = useNotebookStore();
const realm = ref<Realm>("server");
// Side effect: a notebook whose code runs only in the page (no server cell) opens on Client, where its names are,
// rather than on an empty Server list; once, so the user's own switch stays.
watch(
  () => store.cellsInOrder.map((cell) => cell.type),
  (types, before) => {
    const first = before === undefined || before.length === 0;
    if (first && types.includes("client") && !types.includes("server")) realm.value = "client";
  },
  { immediate: true },
);
const filter = ref("");
/** The server kernel cannot answer while it is paused in the debugger: Run and Debug shows its names then. */
const kernelPaused = computed(
  () => realm.value === "server" && store.mirror.notebook?.kernel.state === "paused",
);
const scope = useScope(store, realm);
const numbers = computed(
  () => new Map(store.cellsInOrder.map((cell, at) => [cell.id, String(at + 1)])),
);
/** Each name a server cell exports, with its cell's number: a client name among them shadows it (05-bridge §3.3). */
const exporters = computed(() =>
  exportersOf(store.cellsInOrder, (cell) => store.mirror.graph.get(cell)?.exports),
);
const rows = computed(() => {
  if (scope.value === null || "failed" in scope.value) return [];
  const needle = filter.value.trim().toLowerCase();
  return scope.value.bindings.filter((each) => each.name.toLowerCase().includes(needle));
});

/** The expanded row's name and its full value (null while cell.bindings answers, undefined when it has none, "failed"
 * when the read failed: its toast says why). */
const open = ref<string | null>(null);
const value = shallowRef<BindingValue | null | undefined | "failed">(null);
let reads = 0;
/** Reads the expanded row's value; an answer to an older read (a run settled since) is dropped. */
async function read(binding: Binding): Promise<void> {
  reads += 1;
  const mine = reads;
  const answer = await store.bindings(binding.definedBy);
  if (mine !== reads || open.value !== binding.name) return;
  value.value =
    answer === undefined ? "failed" : answer.bindings.find((each) => each.name === binding.name);
}
function toggle(binding: Binding): void {
  open.value = open.value === binding.name ? null : binding.name;
  value.value = null;
  if (open.value !== null) void read(binding);
}
// a realm switch closes the expanded row: its name may not exist in the other realm
watch(realm, () => {
  open.value = null;
});
/** A server name asked for by name (a value at a line's end) while the server's scope is not shown yet. */
const wanted = ref<string | null>(null);
/** Expands `name`'s row and brings it into view, focused; waits for the scope when it is not there yet. */
function expand(name: string): void {
  const binding = rows.value.find((each) => each.name === name);
  if (binding === undefined) {
    wanted.value = name;
    return;
  }
  wanted.value = null;
  if (open.value !== name) toggle(binding);
  void nextTick(() => {
    // after the inspector's own focus on the group it revealed
    requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(
        `#inspector [data-variable="${CSS.escape(name)}"]`,
      );
      row?.scrollIntoView({ block: "nearest" });
      row?.focus({ preventScroll: true });
    });
  });
}
const ui = useUiStore();
// Side effect: a variable asked for by name switches to Server, clears the filter and expands its row.
watch(
  () => ui.revealed,
  (asked) => {
    if (asked?.section !== "variables" || asked.name === undefined) return;
    filter.value = "";
    if (realm.value === "server") expand(asked.name);
    else {
      realm.value = "server";
      wanted.value = asked.name;
    }
  },
);
// a new scope (a run settled) reads the expanded value again, or closes the row when the name is gone
watch(scope, (now) => {
  const shown = now !== null && "bindings" in now ? now.bindings : [];
  const binding = shown.find((each) => each.name === open.value);
  if (binding === undefined) open.value = null;
  else void read(binding);
  const name = wanted.value;
  if (name !== null && now !== null) {
    wanted.value = null;
    if (shown.some((each) => each.name === name)) expand(name);
  }
});
const count = computed(() =>
  scope.value !== null && "bindings" in scope.value ? scope.value.bindings.length : 0,
);
const columns = "ui:grid ui:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_1.5rem] ui:gap-2 ui:px-1.75";
const output = (each: BindingValue) => ({
  kind: "value" as const,
  json: each.json,
  repr: each.repr,
  truncated: each.truncated,
});
</script>

<template>
  <Section name="variables" title="Variables" :count="count">
    <div class="ui:flex ui:items-center ui:gap-2 ui:pbe-1">
      <Segmented v-model="realm" label="Realm">
        <SegmentedItem value="server">Server</SegmentedItem>
        <SegmentedItem value="client">Client</SegmentedItem>
      </Segmented>
    </div>
    <label v-if="count > 0" class="ui:relative ui:flex ui:items-center ui:pbe-1">
      <span class="ui:visually-hidden">Filter the variables</span>
      <Search
        class="ui:pointer-events-none ui:absolute ui:inset-s-2 ui:text-muted ui:block-3 ui:inline-3"
        aria-hidden="true"
      />
      <TextInput v-model="filter" size="sm" placeholder="Filter" class="ui:flex-1 ui:ps-6" />
    </label>
    <p v-if="kernelPaused" role="status" :class="note" data-testid="scope-paused">Kernel paused</p>
    <p
      v-else-if="scope !== null && 'failed' in scope"
      role="status"
      :class="note"
      data-testid="scope-failed"
    >
      {{ scope.failed }}
    </p>
    <div v-else-if="rows.length > 0" class="ui:flex ui:flex-col">
      <div
        aria-hidden="true"
        :class="[columns, 'ui:items-center ui:text-tiny ui:text-muted ui:block-5']"
      >
        <span>Name</span><span>Value</span><span class="ui:text-end">Cell</span>
      </div>
      <ul aria-label="Variables" class="ui:m-0 ui:list-none ui:p-0">
        <li v-for="binding in rows" :key="binding.name">
          <button
            type="button"
            :aria-expanded="open === binding.name"
            :data-variable="binding.name"
            :class="[
              columns,
              'ui:cursor-pointer ui:items-baseline ui:rounded-control ui:border ui:border-transparent ui:bg-transparent ui:py-0.75 ui:text-start ui:font-mono ui:text-[0.71875rem] ui:text-fg-2 ui:inline-full ui:hover:bg-sheet ui:focus-visible:border-accent ui:aria-expanded:bg-sheet',
            ]"
            @click="toggle(binding)"
          >
            <span class="ui:ellipsis ui:text-fg">{{ binding.name }}</span>
            <span class="ui:ellipsis">{{ binding.preview }}</span>
            <span class="ui:text-end ui:text-muted">{{
              numbers.get(binding.definedBy) ?? ""
            }}</span>
            <span
              v-if="binding.exported"
              data-testid="exported"
              class="ui:col-span-3 ui:font-sans ui:text-tiny ui:text-server"
              >exported</span
            >
            <span
              v-if="realm === 'client' && exporters.has(binding.name)"
              data-testid="shadows"
              class="ui:col-span-3 ui:font-sans ui:text-tiny ui:whitespace-normal ui:text-client"
              >shadows cell {{ exporters.get(binding.name) }}</span
            >
          </button>
          <div
            v-if="open === binding.name"
            class="ui:px-1.75 ui:pbs-1 ui:pbe-2 ui:[--result:var(--side)]"
            data-testid="variable-value"
          >
            <p v-if="value === undefined" :class="note">Undefined</p>
            <p v-else-if="value === 'failed'" :class="note">Could not read the value</p>
            <OutputView
              v-else-if="value !== null"
              :output="output(value)"
              :options="{ view: 'tree', readonly: true, expandDepth: 1 }"
            />
          </div>
        </li>
      </ul>
    </div>
  </Section>
</template>
