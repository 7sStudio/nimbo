<!-- The body of an output: the view detect() chose (or the user switched to), a host renderer when one is registered
for the kind or the display's mime, and raw text for a mime nobody renders. -->
<script setup lang="ts">
import type { Component } from "vue";
import { ref } from "vue";

import type { ShownView } from "../model/detect.js";
import type { Chip } from "../model/chips.js";
import type { ViewInput } from "../model/output.js";
import type { ColumnLayout, Grid } from "../model/records.js";
import type { SearchMatch } from "../model/search.js";
import type { Focus } from "../model/tree.js";
import ActivityRow from "./ActivityRow.vue";
import DomView from "./DomView.vue";
import ErrorView from "./ErrorView.vue";
import PrimitiveView from "./PrimitiveView.vue";
import StreamView from "./StreamView.vue";
import ValueGrid from "./ValueGrid.vue";
import ValueRaw from "./ValueRaw.vue";
import ValueTree from "./ValueTree.vue";

defineProps<{
  readonly input: ViewInput;
  readonly shown: ShownView;
  /** The value shown (a jq result replaces it), its grid (an SQL result replaces it) and its raw text. */
  readonly json: unknown;
  readonly grid: Grid | undefined;
  readonly text: string;
  readonly renderer: Component | undefined;
  readonly matches: ReadonlyMap<string, readonly SearchMatch[]> | undefined;
  readonly focus: Focus | undefined;
  readonly maxHeight: number | undefined;
  readonly expandDepth: number;
  readonly running: boolean;
  readonly timestamps: readonly string[] | undefined;
  readonly wrap: boolean;
  readonly times: boolean;
  readonly raw: boolean;
  readonly onChip: ((chip: Chip) => void) | undefined;
  readonly columns: ColumnLayout | undefined;
  readonly arrange: boolean;
}>();
const selection = defineModel<readonly number[]>("selection", { default: () => [] });
const emit = defineEmits<{ "show-all": []; columns: [layout: ColumnLayout] }>();
defineSlots<{ dom?: () => unknown }>();
const tree = ref<{
  expandAll(): void;
  collapseAll(): void;
  reveal(path: readonly (string | number)[]): void;
} | null>(null);
defineExpose({ tree });
</script>

<template>
  <component :is="renderer" v-if="renderer" :output="input" />
  <ValueTree
    v-else-if="shown === 'tree'"
    ref="tree"
    :json="json"
    label="Output value"
    :expand-depth="expandDepth"
    :matches="matches"
    :focus="focus"
    :max-height="maxHeight"
    @show-all="emit('show-all')"
  />
  <ValueGrid
    v-else-if="shown === 'grid' && grid"
    v-model:selection="selection"
    :grid="grid"
    :root="json"
    label="Output rows"
    :matches="matches"
    :focus="focus"
    :max-height="maxHeight"
    :on-chip="onChip"
    :layout="columns"
    :arrange="arrange"
    @layout="(layout) => emit('columns', layout)"
  />
  <PrimitiveView v-else-if="shown === 'primitive' || shown === 'bytes'" :json="json" />
  <StreamView
    v-else-if="input.kind === 'stream'"
    :text="input.text"
    :stream="input.stream"
    :running="running"
    :timestamps="timestamps"
    :wrap="wrap"
    :show-times="times"
  />
  <ErrorView v-else-if="input.kind === 'error'" :error="input.error" :show-raw="raw" />
  <DomView v-else-if="input.kind === 'dom'" :html="input.html" :text="input.text">
    <template v-if="$slots.dom" #default><slot name="dom" /></template>
  </DomView>
  <ActivityRow
    v-else-if="input.kind === 'event'"
    :name="input.name"
    :data="input.data"
    :at="input.at"
  />
  <ValueRaw
    v-else
    :text="text"
    :json="shown === 'raw'"
    :label="shown === 'raw' ? 'Raw JSON' : 'Output text'"
  />
</template>
