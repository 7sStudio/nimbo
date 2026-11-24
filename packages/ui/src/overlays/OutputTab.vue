<!-- OutputTab: the page at /ui/<name>/out/<execution>/<index>: only output-view's OutputView, at full height, for one output of one execution, with the full-value URL for a retained value; the page's tokens and theme. It shows the cell's last run, the only one the daemon keeps. -->
<script setup lang="ts">
import type { Output } from "@jsnb/core";
import { OutputView } from "@jsnb/output-view";
import { computed } from "vue";

import { failureName, failureWords } from "../app/startFailure";
import { usePageTheme } from "../app/usePageTheme";
import { useNotebookStore } from "../store/notebook";

const props = defineProps<{
  execution: string;
  index: number;
  fullValueUrl: string;
  fetchFullValue: (url: string, signal: AbortSignal) => Promise<Blob>;
}>();

const notebook = useNotebookStore();
const found = computed(() => {
  for (const [cell, execution] of notebook.mirror.executions)
    if (execution.id === props.execution) return { cell, execution };
  return undefined;
});
const output = computed<Output | undefined>(() => found.value?.execution.outputs[props.index]);
const position = computed(() =>
  found.value === undefined
    ? 0
    : notebook.cellsInOrder.findIndex((cell) => cell.id === found.value?.cell) + 1,
);
// a start that stopped (a stale token, a notebook that is gone) or a socket closed for good: say so, never "loading"
const stopped = computed(() =>
  notebook.startFailure !== null || notebook.connection === "closed"
    ? failureWords(failureName(notebook.startFailure), notebook.pageName)
    : null,
);
const loading = computed(() => notebook.mirror.notebook === null);
usePageTheme(document.documentElement, globalThis.localStorage);
</script>

<template>
  <div
    data-testid="output-tab"
    class="jsnb-ui ui:flex ui:flex-col ui:gap-3 ui:bg-bg ui:p-6 ui:font-sans ui:text-ui ui:text-fg ui:min-block-dvh"
  >
    <header class="ui:flex ui:items-baseline ui:gap-2 ui:text-small ui:text-muted">
      <span class="ui:font-semibold ui:text-fg">{{ notebook.mirror.notebook?.path }}</span>
      <span v-if="position > 0">cell {{ position }}, output {{ props.index + 1 }}</span>
    </header>
    <div
      v-if="stopped !== null"
      role="alert"
      data-testid="output-stopped"
      class="ui:flex ui:flex-col ui:gap-1"
    >
      <p class="ui:font-semibold ui:text-err">{{ stopped.title }}</p>
      <p class="ui:text-fg-2">{{ stopped.text }}</p>
    </div>
    <p v-else-if="loading" role="status" class="ui:text-muted">Loading the output…</p>
    <p
      v-else-if="output === undefined"
      role="status"
      class="ui:text-muted"
      data-testid="output-missing"
    >
      This output is gone: the cell ran again since, and only its last run is kept.
    </p>
    <OutputView
      v-else
      :output="output"
      height="fit"
      :full-value-url="output.kind === 'value' ? props.fullValueUrl : undefined"
      :on-fetch-full-value="props.fetchFullValue"
    />
  </div>
</template>
