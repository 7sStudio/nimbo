<!-- The query bar: Filter, JSONPath, jq, SQL, the one-line input or the chips,
the result count, Only matches / All, Show all (after jq or SQL), cancel, the examples, and the notes below. -->
<script setup lang="ts">
import type { QueryMode } from "@jsnb/core";
import { computed, ref } from "vue";

import type { QueryEngines, SqlSchema } from "../model/engines.js";
import { firstUseNotes, firstUseSizes } from "../model/engines.js";
import { examples } from "../model/examples.js";
import { parseFilter } from "../model/filter.js";
import { resultCount, resultTime } from "../model/query.js";
import CheatSheet from "./CheatSheet.vue";
import ChipsEditor from "./ChipsEditor.vue";
import IconButton from "./IconButton.vue";
import QueryInput from "./QueryInput.vue";
import QueryNotes from "./QueryNotes.vue";
import Segments from "./Segments.vue";
import { keywordsOf } from "./queryLanguages.js";
import type { QueryBar } from "./useQueryBar.js";
import TextButton from "./TextButton.vue";
import { metaText } from "./classes/meta.js";

const props = defineProps<{
  readonly bar: QueryBar;
  readonly engines: QueryEngines;
  readonly json: unknown;
  /** The value's keys (chip keys, JSONPath and jq completion) and the SQL table's schema. */
  readonly keys: readonly string[];
  readonly schema: SqlSchema | undefined;
}>();
const names: Readonly<Record<QueryMode, string>> = {
  filter: "Filter",
  jsonpath: "JSONPath",
  jq: "jq",
  sql: "SQL",
};
const sizes: Readonly<Partial<Record<QueryMode, string>>> = firstUseSizes;
const help = ref(false);
const state = computed(() => props.bar.state.value);
const modeOptions = computed(() =>
  props.bar.modes.value.map((mode) => ({
    value: mode,
    label: names[mode],
    note: state.value.loaded.has(mode) ? undefined : firstUseNotes[mode],
    size: state.value.loaded.has(mode) ? undefined : sizes[mode],
  })),
);
const result = computed(() => state.value.result);
const jsonPath = computed(() =>
  state.value.chips.length > 0 ? props.engines.chips?.toJsonPath(state.value.chips) : undefined,
);
const completions = computed(() => {
  const columns =
    props.schema?.columns.flatMap((c) => [c.name, ...c.fields.map((f) => `${c.name}.${f.name}`)]) ??
    [];
  const tables = props.schema ? ["t", ...(props.schema.alias ? [props.schema.alias] : [])] : [];
  const keys = state.value.mode === "jq" ? props.keys.map((key) => `.${key}`) : props.keys;
  return [
    ...(state.value.mode === "sql" ? [...tables, ...columns] : keys),
    ...keywordsOf(state.value.mode),
  ];
});

function pick(query: string): void {
  const parsed = state.value.mode === "filter" ? parseFilter(query) : undefined;
  props.bar.dispatch(
    parsed?.ok ? { type: "chips", chips: parsed.value } : { type: "text", text: query },
  );
}
const run = (pin: boolean) => void props.bar.run(pin);
</script>

<template>
  <!-- the bar's row and the notes under it, spaced by the grid's gap -->
  <div
    data-part="query-bar"
    class="ov:grid ov:grid-cols-[minmax(0,1fr)] ov:gap-1.5 ov:border-be ov:border-border ov:bg-bg-2 ov:px-2 ov:py-1.5"
    role="group"
    aria-label="Query"
  >
    <div data-part="query-row" class="ov:flex ov:flex-wrap ov:items-center ov:gap-1.5">
      <Segments
        :model-value="state.mode"
        label="Query mode"
        :options="modeOptions"
        @update:model-value="(mode) => bar.setMode(mode)"
      />
      <ChipsEditor
        v-if="state.mode === 'filter'"
        :model-value="state.chips"
        :json-path="jsonPath"
        :keys="keys"
        @update:model-value="(chips) => bar.dispatch({ type: 'chips', chips })"
        @run="run"
        @close="bar.reset(true)"
      />
      <QueryInput
        v-else
        :model-value="state.text"
        :mode="state.mode"
        :completions="completions"
        :label="`${names[state.mode]} query`"
        :hint="examples[state.mode][0]?.query ?? ''"
        @update:model-value="(text) => bar.dispatch({ type: 'text', text })"
        @run="run"
        @close="bar.reset(true)"
        @recall="bar.recall"
        @help="help = true"
      />
      <!-- SQL's time keeps one width up to 999 ms, so a run that takes longer or shorter does not move the input -->
      <span v-if="result" data-part="count" :class="metaText"
        >{{ resultCount(result)
        }}<template v-if="resultTime(result)">
          in
          <span data-part="time" class="ov:inline-block ov:min-inline-[7ch]">{{
            resultTime(result)
          }}</span></template
        ></span
      >
      <Segments
        v-if="result?.kind === 'select'"
        :model-value="state.only ? 'only' : 'all'"
        label="Show"
        :options="[
          { value: 'only', label: 'Only matches' },
          { value: 'all', label: 'All' },
        ]"
        @update:model-value="(show) => bar.dispatch({ type: 'only', only: show === 'only' })"
      />
      <!-- the select modes' "All" in a word: the whole value back in place of the result -->
      <TextButton
        v-if="result?.kind === 'transform' || result?.kind === 'rows'"
        @click="bar.reset(false)"
      >
        Show all
      </TextButton>
      <IconButton
        v-if="state.status === 'running'"
        label="Cancel query"
        icon="stop"
        @click="bar.cancel()"
      />
      <CheatSheet v-model:open="help" :mode="state.mode" @pick="pick" />
    </div>
    <QueryNotes :bar="bar" :json="json" :sql="engines.sql" />
  </div>
</template>
