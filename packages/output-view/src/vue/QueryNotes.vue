<!-- The lines under the query bar (11-query §4): jq's or the SQL engine's first download with its size and progress,
the elapsed time of a running query, the error with its position underlined, "download all" past the row cap, and a
JSONPath selection copied or exported as a list. -->
<script setup lang="ts">
import type { Path } from "@jsnb/core";
import { computed } from "vue";

import type { SqlQueryEngine } from "../model/engines.js";
import { firstUseSizes } from "../model/engines.js";
import { exportSelection } from "../model/export.js";
import { plural } from "../model/preview.js";
import { formatBytes } from "../model/summary.js";
import { downloadFile } from "./clipboard.js";
import { placeOf, useViewer } from "./context.js";
import type { QueryBar } from "./useQueryBar.js";
import TextButton from "./TextButton.vue";

const props = defineProps<{
  readonly bar: QueryBar;
  readonly json: unknown;
  readonly sql: SqlQueryEngine | undefined;
}>();
const viewer = useViewer();
const state = computed(() => props.bar.state.value);
const progress = computed(() => props.bar.progress.value);
const error = computed(() => state.value.error);
const result = computed(() => state.value.result);
const query = computed(() => (state.value.mode === "filter" ? "" : state.value.text));
/** jq's or SQL's first download, named with its size until the engine is loaded (11-query §4). */
const download = computed(() => {
  const { mode, loaded } = state.value;
  if (loaded.has(mode)) return undefined;
  if (mode === "sql") return `the SQL engine (DuckDB, ${firstUseSizes.sql}`;
  return mode === "jq" ? `jq (WebAssembly, ${firstUseSizes.jq}` : undefined;
});
const at = computed(() => error.value?.position);
const paths = computed((): readonly Path[] =>
  result.value?.kind === "select" ? result.value.paths : [],
);

async function downloadAll(format: "csv" | "ndjson"): Promise<void> {
  const sql = props.sql;
  if (sql === undefined) return;
  const query = state.value.text;
  await viewer.run(`Downloading every row as ${format.toUpperCase()}`, async (signal) => {
    downloadFile(`rows.${format}`, await sql.exportAll(query, { format, signal }));
  });
}
function exportList(format: "json" | "ndjson"): void {
  const exported = exportSelection(
    props.json,
    paths.value,
    format,
    placeOf(viewer, props.json).root,
  );
  if (format === "json") void viewer.copy("selection", exported.text.trimEnd());
  else downloadFile(`selection.${exported.extension}`, exported.text, exported.mime);
}
/** A line under the bar: 12 px in the secondary color. */
const note = "ov:m-0 ov:text-small ov:text-fg-2";
</script>

<template>
  <p v-if="download" data-part="query-note" :class="note">
    {{ state.status === "loading" ? "Loading" : "Enter loads" }} {{ download }}, one download, then
    kept in the browser cache)<template v-if="progress">
      , {{ formatBytes(progress.loadedBytes) }} of {{ formatBytes(progress.totalBytes) }}</template
    >
  </p>
  <p v-if="state.status === 'running'" data-part="query-note" :class="note" aria-live="polite">
    Running, {{ (bar.elapsed.value / 1000).toFixed(1) }} s
  </p>
  <p v-if="error" data-part="query-error" class="ov:m-0 ov:text-small ov:text-err" role="alert">
    {{ error.message
    }}<code
      v-if="at !== undefined && query !== ''"
      data-part="error-text"
      class="ov:block ov:font-mono ov:whitespace-pre ov:text-fg-2"
      >{{ query.slice(0, at)
      }}<mark
        data-part="error-at"
        class="ov:bg-err-soft ov:text-inherit ov:underline ov:decoration-err ov:decoration-wavy"
        >{{ query.slice(at, at + 1) || " " }}</mark
      >{{ query.slice(at + 1) }}</code
    >
  </p>
  <p v-if="result?.kind === 'rows' && result.truncated && sql" data-part="query-note" :class="note">
    Capped at {{ plural(result.rows.length, "row", "rows") }}, download all as
    <TextButton @click="downloadAll('csv')">CSV</TextButton>
    <TextButton @click="downloadAll('ndjson')">NDJSON</TextButton>
  </p>
  <p v-if="paths.length > 0" data-part="query-note" :class="note">
    <TextButton @click="exportList('json')">Copy JSON</TextButton>
    <TextButton @click="exportList('ndjson')"> Export NDJSON </TextButton>
  </p>
</template>
