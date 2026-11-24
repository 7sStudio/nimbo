<!-- The output's header: one quiet line in words, always visible: what the result is called, then
its kind, count and size (`Balance` `object, 6 keys, 1.2 KB`), "truncated" and "not transferable" said in the same words,
no pill and no rule under it; then the tools, shown on hover or focus: find, query, expand / collapse all, stream and
error toggles, copy, export, fit, full screen (the last two not in full screen itself); and at the right end the view
switch (Tree, Grid, Raw), always there when there is a choice. In an output under 34rem (a host's narrow side panel) the
summary takes the first row whole, so its name is never cut for the tools, and the tools that need room or mean
nothing there (query, expand and collapse all, fit) give way. Double-clicking the header toggles the height cap. -->
<script setup lang="ts">
import type { SwitchView } from "../model/detect.js";
import { computed } from "vue";

import { primitiveNames, summaryParts, summaryText } from "../model/summary.js";
import IconButton from "./IconButton.vue";
import Segments from "./Segments.vue";
import type { ToolbarState } from "./useChrome.js";

const props = defineProps<{ readonly state: ToolbarState }>();
const view = defineModel<SwitchView>("view", { required: true });
const wrap = defineModel<boolean>("wrap", { default: true });
const times = defineModel<boolean>("times", { default: false });
const raw = defineModel<boolean>("raw", { default: false });
const emit = defineEmits<{
  action: [name: "find" | "query" | "expand" | "collapse" | "fit" | "fullscreen"];
}>();
const parts = computed(() =>
  [summaryParts(props.state.summary), ...(props.state.notTransferable ? ["not transferable"] : [])]
    .filter((part) => part !== "")
    .join(", "),
);
/** A bare primitive (`number`, `boolean`…) needs no caption above its value, as in Jupyter's Out: the value says it, and the toolbar floats at the output's top end instead of taking a row. */
const bare = computed(() => parts.value === "" && primitiveNames.has(props.state.summary.name));
/** The whole line, the summary's tooltip when its words are cut. */
const line = computed(() =>
  [
    summaryText(props.state.summary),
    ...(props.state.notTransferable ? ["not transferable"] : []),
  ].join(", "),
);
const labels: Readonly<Record<SwitchView, string>> = {
  tree: "Tree",
  grid: "Grid",
  raw: "Raw",
};
</script>

<template>
  <div
    data-part="toolbar"
    class="ov:flex ov:min-block-7 ov:flex-wrap ov:items-center ov:gap-x-3 ov:gap-y-0.5 ov:px-2 ov:py-0.5 ov:text-meta ov:text-fg-2"
    :class="bare ? 'ov:absolute ov:inset-bs-0 ov:end-0' : ''"
    :data-bare="bare ? '' : undefined"
    @dblclick.self="emit('action', 'fit')"
  >
    <!-- the name keeps its place and the words after it give way first: they ellipsize, the whole line in the title -->
    <span
      data-part="summary"
      class="ov:flex ov:flex-1 ov:items-baseline ov:gap-3 ov:whitespace-nowrap ov:min-inline-0 ov:@max-[34rem]:basis-full"
      :title="line"
      @dblclick="emit('action', 'fit')"
    >
      <span
        v-if="!bare"
        data-part="summary-name"
        class="ov:shrink-0 ov:overflow-clip ov:font-mono ov:text-small ov:font-medium ov:text-ellipsis ov:text-fg ov:max-inline-[70%]"
        >{{ state.summary.name }}</span
      >
      <span
        v-if="parts !== ''"
        data-part="summary-parts"
        class="ov:overflow-clip ov:text-ellipsis ov:min-inline-0"
        >{{ parts }}</span
      >
    </span>
    <slot />
    <!-- the tools show on hover or a keyboard focus inside the output (focus-visible, 08 §7) and stay in the
    tab order; always in full screen, on a screen without hover, and in an output under 34rem, where they
    wrap under the summary and hidden would leave its row blank -->
    <span
      data-part="tools"
      class="ov:inline-flex ov:flex-wrap ov:items-center ov:gap-0.5 ov:opacity-0 ov:group-has-focus-visible/output:opacity-100 ov:group-hover/output:opacity-100 ov:in-data-[part=dialog]:opacity-100 ov:@max-[34rem]:opacity-100 ov:[@media(hover:none)]:opacity-100"
    >
      <template v-if="state.shown === 'tree' || state.shown === 'grid'">
        <IconButton
          label="Find"
          icon="search"
          shortcut="⌘F"
          :pressed="state.find"
          @click="emit('action', 'find')"
        />
        <IconButton
          v-if="state.query !== undefined"
          label="Query"
          icon="filter"
          shortcut="⌘⇧F"
          :pressed="state.query"
          class="ov:@max-[34rem]:hidden"
          @click="emit('action', 'query')"
        />
      </template>
      <template v-if="state.shown === 'tree'">
        <IconButton
          label="Expand all"
          icon="expandAll"
          class="ov:@max-[34rem]:hidden"
          @click="emit('action', 'expand')"
        />
        <IconButton
          label="Collapse all"
          icon="collapseAll"
          class="ov:@max-[34rem]:hidden"
          @click="emit('action', 'collapse')"
        />
      </template>
      <template v-if="state.shown === 'stream'">
        <IconButton label="Wrap lines" icon="wrap" :pressed="wrap" @click="wrap = !wrap" />
        <IconButton
          v-if="state.timestamps"
          label="Timestamps"
          icon="clock"
          :pressed="times"
          @click="times = !times"
        />
      </template>
      <IconButton
        v-if="state.shown === 'error'"
        label="Raw stack"
        icon="code"
        :pressed="raw"
        @click="raw = !raw"
      />
      <slot name="menus" />
      <template v-if="!state.nested">
        <IconButton
          :label="state.fit ? 'Cap the height' : 'Fit to content'"
          icon="fit"
          :pressed="state.fit"
          class="ov:@max-[34rem]:hidden"
          @click="emit('action', 'fit')"
        />
        <IconButton
          label="Full screen"
          icon="maximize"
          shortcut="⌘⇧O"
          @click="emit('action', 'fullscreen')"
        />
      </template>
    </span>
    <Segments
      v-if="state.views.length > 1"
      v-model="view"
      label="View"
      :options="state.views.map((value) => ({ value, label: labels[value] }))"
    />
  </div>
</template>
