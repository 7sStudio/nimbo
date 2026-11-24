<!-- OutputView as the package exports it: the viewer with the built-in renderers (HTML, images)
already registered, plus a host's from `renderers` or from an ancestor that provides rendererKey. -->
<script setup lang="ts">
import { computed, inject, provide } from "vue";

import type { OutputViewEmits, OutputViewProps } from "../vue/options.js";
import OutputView from "../vue/OutputView.vue";
import type { RendererRegistry } from "../vue/renderers.js";
import { emptyRegistry, mergeRegistries, rendererKey } from "../vue/renderers.js";
import { defaultRenderers } from "./registry.js";

const props = defineProps<
  OutputViewProps & { readonly renderers?: RendererRegistry | undefined }
>();
const emit = defineEmits<OutputViewEmits>();
defineSlots<{ dom?: () => unknown }>();
const inherited = inject(rendererKey, emptyRegistry);
const merged = computed(() =>
  mergeRegistries(defaultRenderers, inherited, props.renderers ?? emptyRegistry),
);
// The registry the viewer reads, derived: its getters follow `renderers` (and an ancestor's registry), and the
// renderer components themselves are never made reactive.
const registry: RendererRegistry = {
  get mimes() {
    return merged.value.mimes;
  },
  get kinds() {
    return merged.value.kinds;
  },
};
provide(rendererKey, registry);
</script>

<template>
  <OutputView
    :output="output"
    :options="options"
    :engines="engines"
    :full-value-url="fullValueUrl"
    :query="query"
    :height="height"
    :alias="alias"
    :running="running"
    :timestamps="timestamps"
    :columns="columns"
    :on-load-more="onLoadMore"
    :on-fetch-full-value="onFetchFullValue"
    :on-function-source="onFunctionSource"
    @view-change="(view) => emit('view-change', view)"
    @query-change="(pin) => emit('query-change', pin)"
    @jump="(target) => emit('jump', target)"
    @open-fullscreen="emit('open-fullscreen')"
    @open-in-tab="(path) => emit('open-in-tab', path)"
    @copy="(event) => emit('copy', event)"
    @height-change="(height) => emit('height-change', height)"
    @columns-change="(layout) => emit('columns-change', layout)"
  >
    <template v-if="$slots.dom" #dom><slot name="dom" /></template>
  </OutputView>
</template>
