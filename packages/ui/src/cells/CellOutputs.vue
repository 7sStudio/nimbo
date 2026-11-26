<!-- CellOutputs: a cell's result under its code, one tone down and starting on the code's text edge: one OutputView per output in order, space between them; a route cell's requests under its listening routes (RouteRequests) in place of the disposer route() returns, and the other event outputs grouped into one ActivityList after them; the cap (seven lines, or outputs.maxHeightPx when it is set) unless the cell is fit, its control the page's own under a cell (a footer slot, ResultFooter) and the viewer's Expand in the inspector; the first value output carries the cell's view and pinned query; a client cell's real container slotted into its DOM output's [data-live] slot on the page that holds it, and while its run is in progress into a slot of its own after the outputs. The page's ⌘F, ⌘⇧F and ⌘⇧O reach the first value output as its own keys. -->
<script setup lang="ts">
import type { MetaPatch } from "./card";
import type { CellMeta, Output, Route } from "@jsnb/core";
import type { CopyEvent, JumpTarget, LoadMoreRequest, OutputHeight } from "@jsnb/output-view";
import { OutputView } from "@jsnb/output-view";
import type { QueryPin, ValueSlice, ViewOption } from "@jsnb/output-view/model";
import { computed, defineAsyncComponent, ref } from "vue";

import type { OutputKeys } from "./card";
import LiveSlot from "./LiveSlot.vue";
import { forwardOutputKeys } from "./outputKeys";
import type { OutputHost } from "./outputHost";
import RouteRequests from "./RouteRequests.vue";
import { isRouteDisposer, routeHits } from "./routeHits";
import { fullValuePath } from "../store/fullValue";
import { useSettingsStore } from "../store/settings";

// A run's events are rare: their list is loaded when a result first has some.
const ActivityList = defineAsyncComponent(() => import("./ActivityList.vue"));

const props = defineProps<{
  outputs: readonly Output[];
  execution: string | null;
  meta: CellMeta;
  maxHeight: number;
  running: boolean;
  host: OutputHost;
  mac: boolean;
  /** The cell's live container, when this page holds it: moved into the DOM output's slot. */
  live: {
    readonly slotInto: (into: HTMLElement) => boolean;
    readonly release: (from: HTMLElement) => void;
  } | null;
  request: OutputKeys | null;
  loadMore: (index: number, request: LoadMoreRequest, signal: AbortSignal) => Promise<ValueSlice>;
  /** The cell that defines a function the output shows ("view source in cell 3"), if any. */
  functionSource?: (name: string) => { readonly cell: string; readonly label: string } | undefined;
  /** The routes the cell registered that are listening, whose requests its result shows. */
  routes?: readonly Route[];
  /** The cell's text: a route() call there makes its disposer value nothing to show. */
  source?: string;
  /** Where the result shows: under its cell (the page draws the height cap's control, ResultFooter) or in the
   * inspector's Pinned result group (the viewer's own Expand, no inset). */
  place?: "cell" | "inspector";
}>();
const emit = defineEmits<{
  meta: [patch: MetaPatch];
  copy: [event: CopyEvent];
  jump: [target: JumpTarget];
  /** The request reached the output (or there is no value output to take it). */
  handled: [];
  copyText: [text: string, what: string];
}>();

const shown = computed(() =>
  props.outputs.flatMap((output, index) =>
    output.kind === "event" || isRouteDisposer(output, props.source ?? "")
      ? []
      : [{ output, index }],
  ),
);
const requests = computed(() =>
  routeHits(
    props.routes ?? [],
    props.outputs.flatMap((output) => (output.kind === "event" ? [output] : [])),
  ),
);
const events = computed(() => requests.value.rest);
const primary = computed(() => shown.value.find(({ output }) => output.kind === "value")?.index);
/** The output whose grid keeps the cell's column layout (meta.outputColumns): the first value, display.json or
 * display.table output. */
const columnsOwner = computed(
  () =>
    shown.value.find(
      ({ output }) =>
        output.kind === "value" ||
        (output.kind === "display" &&
          (output.mime === "application/json" ||
            output.mime === "application/vnd.jsnb.table+json")),
    )?.index,
);
const firstDom = computed(() => shown.value.find(({ output }) => output.kind === "dom")?.index);
/** While a client run is in progress its container shows in the cell, before the dom output its end brings, so what
 * the run renders (a form, a Pay button it awaits) is there to see and use. */
const liveRunning = computed(
  () => props.live !== null && props.running && firstDom.value === undefined,
);
/** Anything to show under the code: an output, a route's requests, an event, or the running cell's container. */
const any = computed(
  () =>
    shown.value.length > 0 ||
    requests.value.routes.length > 0 ||
    events.value.length > 0 ||
    liveRunning.value,
);
const inCell = computed(() => props.place !== "inspector");
const settings = useSettingsStore();
/** outputs.defaultView and outputs.expandDepth, live: a view the cell chose (meta.outputView) still wins. */
const defaultView = computed((): ViewOption => {
  const view = settings.valueOf("outputs.defaultView");
  return view === "tree" || view === "grid" || view === "raw" ? view : "auto";
});
const expandDepth = computed(() => {
  const depth = settings.valueOf("outputs.expandDepth");
  return typeof depth === "number" ? depth : 2;
});
const options = computed(() => ({
  maxHeight: props.maxHeight,
  expandControl: !inCell.value,
  view: defaultView.value,
  expandDepth: expandDepth.value,
}));
const primaryOptions = computed(() => ({
  ...options.value,
  view: props.meta.outputView ?? defaultView.value,
}));
const query = computed<QueryPin | undefined>(() => props.meta.outputQuery);
/** Whether the viewer's pin differs from the cell's: the viewer reports its pin again when it runs it (a jq or SQL
 * engine that loaded), and an update that changes nothing would leave the save state at "saving", since the daemon
 * then has nothing to write. */
const pinChanged = (pin: QueryPin | undefined): boolean => {
  const held = query.value;
  if (pin === undefined || held === undefined) return pin !== held;
  return pin.mode !== held.mode || pin.query !== held.query || (pin.at ?? "$") !== (held.at ?? "$");
};
const list = ref<HTMLElement | null>(null);
defineExpose({ list });

const fullValueUrl = (output: Output, index: number) =>
  output.kind === "value" && output.truncated && props.execution !== null
    ? fullValuePath(props.execution, index)
    : undefined;
const openTab = (index: number) => {
  if (props.execution !== null)
    window.open(props.host.tabUrl(props.execution, index), "_blank", "noopener");
};
// Side effect: a page request becomes the viewer's own key on the first value output (outputKeys.ts).
forwardOutputKeys({
  request: () => props.request,
  target: () =>
    list.value?.querySelector<HTMLElement>(
      `[data-index="${String(primary.value)}"] [data-part="output"]`,
    ) ?? null,
  mac: () => props.mac,
  handled: () => {
    emit("handled");
  },
});
</script>

<template>
  <div
    v-if="any"
    ref="list"
    data-part="outputs"
    :class="[
      'ui:flex ui:flex-col ui:gap-2 ui:bg-result ui:pbs-2 ui:pbe-2.25',
      inCell ? 'ui:ps-(--cell-inset) ui:pe-4' : 'ui:px-2',
    ]"
  >
    <div
      v-for="{ output, index } in shown"
      :key="index"
      :data-index="index"
      class="ui:min-inline-0"
    >
      <OutputView
        :output="output"
        :options="index === primary ? primaryOptions : options"
        :engines="props.host.engines"
        :query="index === primary ? query : undefined"
        :height="props.meta.outputHeight"
        :columns="index === columnsOwner ? props.meta.outputColumns : undefined"
        :running="props.running"
        :full-value-url="fullValueUrl(output, index)"
        :on-fetch-full-value="props.host.fetchFullValue"
        :on-load-more="(request, signal) => props.loadMore(index, request, signal)"
        :on-function-source="props.functionSource"
        @view-change="(view) => index === primary && emit('meta', { outputView: view })"
        @query-change="
          (pin) =>
            index === primary && pinChanged(pin) && emit('meta', { outputQuery: pin ?? null })
        "
        @height-change="(height: OutputHeight) => emit('meta', { outputHeight: height })"
        @columns-change="
          (layout) =>
            index === columnsOwner &&
            emit('meta', {
              outputColumns:
                layout.hidden === undefined && layout.order === undefined ? null : layout,
            })
        "
        @copy="(event) => emit('copy', event)"
        @jump="(target) => emit('jump', target)"
        @open-in-tab="() => openTab(index)"
      >
        <template v-if="props.live !== null && index === firstDom" #dom>
          <LiveSlot :slot-into="props.live.slotInto" :release="props.live.release" />
        </template>
      </OutputView>
    </div>
    <RouteRequests
      v-if="requests.routes.length > 0"
      :routes="requests.routes"
      @copy-text="(text, what) => emit('copyText', text, what)"
    />
    <ActivityList v-if="events.length > 0" :events="events" />
    <!-- the running cell's container, isolated as a dom output's: data-live keeps every rule of ours away and the
    container's own style (all: initial) stops what the card would pass down -->
    <div
      v-if="liveRunning && props.live !== null"
      data-testid="live-running"
      class="ui:min-inline-0"
    >
      <div data-live="">
        <LiveSlot :slot-into="props.live.slotInto" :release="props.live.release" />
      </div>
    </div>
    <slot name="footer" />
  </div>
</template>
