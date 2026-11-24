<!-- BottomPanel: the panel under the notebook, for what the notebook reports while it works: the Console (every line the cells printed, server and page), Activity (cell runs, bridge calls and route requests, with its count), the Kernel log and Problems (the cells whose last run failed, with their count). Its tabs are its first row, with Hide (⌘J) at the end. Each tab's body is a chunk loaded the first time it opens. -->
<script setup lang="ts">
import type { Component } from "vue";
import { defineAsyncComponent } from "vue";

import { useDispatcher } from "../commands/dispatch";
import type { BottomTab } from "../store/layout";
import { useActivityStore } from "../store/activity";
import { useNotebookStore } from "../store/notebook";
import { useUiStore } from "../store/ui";
import ViewHead from "./ViewHead.vue";

const tabs: readonly { readonly id: BottomTab; readonly title: string }[] = [
  { id: "console", title: "Console" },
  { id: "activity", title: "Activity" },
  { id: "kernelLog", title: "Kernel log" },
  { id: "problems", title: "Problems" },
];
const bodies: Readonly<Record<BottomTab, Component>> = {
  console: defineAsyncComponent(() => import("./ConsoleTab.vue")),
  activity: defineAsyncComponent(() => import("./ActivityTab.vue")),
  kernelLog: defineAsyncComponent(() => import("./KernelLogTab.vue")),
  problems: defineAsyncComponent(() => import("./ProblemsTab.vue")),
};
const ui = useUiStore();
const notebook = useNotebookStore();
const activity = useActivityStore();
const dispatcher = useDispatcher();
/** ← and → move between the tabs, as a tab list's keyboard does. */
function step(by: 1 | -1): void {
  const at = tabs.findIndex((tab) => tab.id === ui.layout.bottom.tab);
  const next = tabs[(at + by + tabs.length) % tabs.length];
  if (next === undefined) return;
  void dispatcher.dispatch("ui.panel.open", { which: next.id });
  document.getElementById(`tab-${next.id}`)?.focus();
}
</script>

<template>
  <section
    data-keys="own"
    aria-labelledby="bottom-title"
    class="ui:flex ui:flex-1 ui:flex-col ui:px-3 ui:pbe-2.5 ui:min-block-0 ui:min-inline-0"
  >
    <ViewHead id="bottom-title" title="Panel" region="bottom" quiet>
      <span
        role="tablist"
        aria-label="Panel"
        class="ui:flex ui:items-center ui:gap-4"
        @keydown.right.prevent="step(1)"
        @keydown.left.prevent="step(-1)"
      >
        <button
          v-for="tab in tabs"
          :id="`tab-${tab.id}`"
          :key="tab.id"
          type="button"
          role="tab"
          :aria-selected="ui.layout.bottom.tab === tab.id"
          aria-controls="bottom-body"
          :tabindex="ui.layout.bottom.tab === tab.id ? 0 : -1"
          class="ui:inline-flex ui:cursor-pointer ui:items-center ui:gap-1 ui:rounded-control ui:border ui:border-transparent ui:bg-transparent ui:px-0.5 ui:text-ui ui:text-muted ui:block-6 ui:hover:text-fg ui:focus-visible:border-accent ui:aria-selected:font-semibold ui:aria-selected:text-fg"
          @click="dispatcher.dispatch('ui.panel.open', { which: tab.id })"
        >
          {{ tab.title }}
          <span
            v-if="tab.id === 'problems'"
            class="ui:font-mono ui:text-tiny ui:font-normal"
            data-testid="problems-count"
            >{{ notebook.errors.length + notebook.diagnosticCount }}</span
          >
          <span
            v-if="tab.id === 'activity'"
            class="ui:font-mono ui:text-tiny ui:font-normal"
            data-testid="activity-count"
            >{{ activity.rows.length }}</span
          >
        </button>
      </span>
      <span class="ui:ms-auto" />
    </ViewHead>
    <div
      id="bottom-body"
      role="tabpanel"
      :aria-labelledby="`tab-${ui.layout.bottom.tab}`"
      class="ui:flex ui:flex-1 ui:flex-col ui:min-block-0"
    >
      <component :is="bodies[ui.layout.bottom.tab]" :key="ui.layout.bottom.tab" />
    </div>
  </section>
</template>
