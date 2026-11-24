<!-- The viewer: an Output of 03-api §5 checked with toOutput, under its header (summary, tools,
query bar), the body detect() chose, the height cap with its expand control, and full screen: this same component
again, nested in the dialog. -->
<script setup lang="ts">
import { TooltipProvider } from "reka-ui";
import { computed, reactive, ref, toRef, watch } from "vue";

import type { ColumnLayout } from "../model/records.js";

import type { OutputViewEmits, OutputViewProps } from "./options.js";
import FullscreenDialog from "./FullscreenDialog.vue";
import OutputBody from "./OutputBody.vue";
import OutputHeader from "./OutputHeader.vue";
import { useChrome } from "./useChrome.js";
import { notifyOf, useFrame } from "./useFrame.js";
import { useOutputView } from "./useOutputView.js";
import { useOverflow } from "./useOverflow.js";
import ViewerTooltip from "./ViewerTooltip.vue";

const props = defineProps<OutputViewProps>();
const emit = defineEmits<OutputViewEmits>();
defineSlots<{ dom?: () => unknown }>();
// The props as one reactive object for the composables, each named here (toRef keeps it fine-grained).
const host: Readonly<OutputViewProps> = reactive({
  output: toRef(props, "output"),
  options: toRef(props, "options"),
  engines: toRef(props, "engines"),
  fullValueUrl: toRef(props, "fullValueUrl"),
  query: toRef(props, "query"),
  height: toRef(props, "height"),
  alias: toRef(props, "alias"),
  running: toRef(props, "running"),
  timestamps: toRef(props, "timestamps"),
  onLoadMore: toRef(props, "onLoadMore"),
  onFetchFullValue: toRef(props, "onFetchFullValue"),
  onFunctionSource: toRef(props, "onFunctionSource"),
});
const out = useOutputView(host, notifyOf(emit));
const body = ref<InstanceType<typeof OutputBody> | null>(null);
const chrome = useChrome(
  props,
  out,
  computed(() => body.value?.tree),
);
const { value, layout, shown, bar, fullscreen } = out;
const { renderer, capped, caps, own, nestedOptions } = useFrame(props, out);
const section = ref<HTMLElement | null>(null);
const overflows = useOverflow(section);
// The grid's arranged columns: shown at once, the host told to keep them (cell meta), its next prop wins.
const columnLayout = ref<ColumnLayout | undefined>(props.columns);
watch(
  () => props.columns,
  (next) => {
    columnLayout.value = next;
  },
);
function arrangeColumns(layout: ColumnLayout): void {
  columnLayout.value = layout;
  emit("columns-change", layout);
}
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <section
      ref="section"
      class="jsnb-ov ov:group/output ov:@container ov:relative ov:block ov:min-inline-0 ov:in-data-[part=dialog]:flex ov:in-data-[part=dialog]:min-block-0 ov:in-data-[part=dialog]:flex-1 ov:in-data-[part=dialog]:flex-col"
      data-part="output"
      :data-theme="options?.theme"
      :data-height="layout.height.value"
      :style="caps"
      aria-label="Output"
      @keydown="chrome.actions.onKeydown"
    >
      <p
        v-if="!value.checked.value.ok"
        data-part="invalid"
        class="ov:m-0 ov:px-2 ov:py-1 ov:text-small ov:text-err"
        role="alert"
      >
        {{ value.checked.value.message }}
      </p>
      <template v-else-if="shown.input.value">
        <OutputHeader :out="out" :chrome="chrome" />
        <OutputBody
          ref="body"
          v-model:selection="chrome.selection.value"
          :input="shown.input.value"
          :shown="shown.shown.value"
          :json="shown.json.value"
          :grid="shown.grid.value"
          :text="shown.text.value"
          :renderer="renderer"
          :matches="shown.matches.value"
          :focus="shown.focus.value"
          :max-height="capped"
          :expand-depth="options?.expandDepth ?? 2"
          :running="running === true"
          :timestamps="timestamps"
          :wrap="chrome.switches.wrap.value"
          :times="chrome.switches.times.value"
          :raw="chrome.switches.raw.value"
          :on-chip="bar.modes.value.includes('filter') ? bar.addChip : undefined"
          :columns="columnLayout"
          :arrange="options?.readonly !== true"
          @show-all="out.search.showAll.value = true"
          @columns="arrangeColumns"
        >
          <template v-if="$slots.dom" #dom><slot name="dom" /></template>
        </OutputBody>
        <button
          v-if="capped !== undefined && overflows && options?.expandControl !== false"
          type="button"
          data-part="expand"
          class="ov:m-0 ov:block ov:inline-full ov:cursor-pointer ov:border-0 ov:border-bs ov:border-border ov:bg-bg-2 ov:px-2 ov:py-1 ov:text-small ov:text-fg-2"
          @click="layout.toggleHeight"
        >
          Expand
        </button>
        <FullscreenDialog
          v-if="!out.nested"
          v-model:open="fullscreen.open"
          v-model:json="fullscreen.json"
          v-model:path="fullscreen.path"
          :summary="chrome.summary.value"
          :truncated="own && value.truncated.value"
          :full-value-url="own ? fullValueUrl : undefined"
          @open-in-tab="(path) => emit('open-in-tab', path)"
        >
          <template #default="nested">
            <OutputView
              :output="nested.output"
              :options="nestedOptions"
              :engines="engines"
              height="fit"
              :full-value-url="nested.fullValueUrl"
              :columns="columnLayout"
              :on-fetch-full-value="onFetchFullValue"
              :on-function-source="onFunctionSource"
              @columns-change="arrangeColumns"
              @copy="(event) => emit('copy', event)"
              @jump="(target) => emit('jump', target)"
            />
          </template>
        </FullscreenDialog>
      </template>
      <ViewerTooltip v-if="out.ownsTips" :tips="out.context.tips" :theme="options?.theme" />
    </section>
  </TooltipProvider>
</template>

<style src="./utilities.css"></style>
<style src="./chrome.css"></style>
