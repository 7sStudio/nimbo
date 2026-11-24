<!-- DiffCell: one cell of the notebook diff, drawn as a cell (after ReviewNB and GitNotebooks): its head with the number, the type, the name, what happened (Added, Removed, Modified, Moved, a type change "server → client") and its line counts; then its body: a modified code cell's source diff, an added or a removed cell on the green or the red band, an unchanged one as it is, a markdown cell rendered (MarkdownDiff) unless Raw Markdown; the saved run's changes (OutputsDiff) unless Hide Outputs; with Metadata Changes, the keys that changed. A click on the head opens the notebook at the cell. -->
<script setup lang="ts">
import type { DiffRow } from "@jsnb/core";
import { cellName } from "@jsnb/core";
import { computed } from "vue";

import { typeTone } from "../cells/tones";
import TypeIcon from "../cells/TypeIcon.vue";
import LazyPane from "./LazyPane.vue";
import MarkdownDiff from "./MarkdownDiff.vue";
import OutputsDiff from "./OutputsDiff.vue";

const props = defineProps<{
  row: DiffRow;
  changed: boolean;
  sideBySide: boolean;
  rawMarkdown: boolean;
  metadata: boolean;
  /** Hide Outputs is off: a changed saved run shows under the source. */
  outputs: boolean;
}>();
const emit = defineEmits<{ open: [cell: string] }>();

const side = computed(() => props.row.after ?? props.row.before);
const type = computed(() => side.value?.type ?? "server");
const source = computed(() => side.value?.source ?? "");
const name = computed(() => cellName({ type: type.value, source: source.value }, undefined, []));
const badge = computed(() => {
  const { status, moved, changes } = props.row;
  if (status === "added") return { text: "Added", tone: "ui:text-ok-text ui:bg-ok-soft" };
  if (status === "removed") return { text: "Removed", tone: "ui:text-err-text ui:bg-err-soft" };
  if (
    status === "modified" &&
    (changes.source || changes.type || props.metadata || (props.outputs && changes.outputs))
  )
    return { text: "Modified", tone: "ui:text-warn-text ui:bg-warn-soft" };
  if (moved !== undefined) return { text: "Moved", tone: "ui:text-accent-text ui:bg-accent-soft" };
  return null;
});
const moved = computed(() =>
  props.row.moved === undefined ? "" : `from ${String(props.row.moved.from + 1)}`,
);
const counts = computed(() => {
  const text = props.row.changes.source;
  if (text === undefined || props.row.status === "unchanged") return [];
  return [
    ...(text.added > 0 ? [{ text: `+${String(text.added)}`, tone: "ui:text-ok-text" }] : []),
    ...(text.removed > 0 ? [{ text: `−${String(text.removed)}`, tone: "ui:text-err-text" }] : []),
  ];
});
/** An added cell, or one whose source did not change (context, moved, a type change): rendered once. */
const sameProse = computed(
  () =>
    props.row.status === "added" ||
    (props.row.status !== "removed" && props.row.changes.source === undefined),
);
const markdown = computed(() => type.value === "markdown" && !props.rawMarkdown);
const language = computed(() => (type.value === "markdown" ? "markdown" : "code"));
const band = computed(() =>
  props.row.status === "added"
    ? "ui:bg-[color-mix(in_oklch,var(--ok)_8%,transparent)]"
    : props.row.status === "removed"
      ? "ui:bg-[color-mix(in_oklch,var(--err)_8%,transparent)]"
      : "",
);
const label = computed(() => `Cell ${String((side.value?.index ?? 0) + 1)} source`);
const shown = (value: unknown) => (value === undefined ? "—" : JSON.stringify(value));
const number = computed(() => (side.value?.index ?? 0) + 1);
</script>

<template>
  <article
    :data-change="props.changed ? '' : undefined"
    :data-status="props.row.status"
    tabindex="-1"
    class="ui:flex ui:flex-col ui:border ui:border-border ui:bg-sheet ui:min-inline-0"
  >
    <button
      type="button"
      :title="`Open the notebook at cell ${String(number)}`"
      class="ui:flex ui:cursor-pointer ui:items-center ui:gap-3 ui:border-0 ui:bg-head ui:px-3 ui:text-start ui:font-inherit ui:text-fg-2 ui:block-7.5 ui:min-inline-0 ui:hover:bg-head-focus"
      @click="emit('open', side?.id ?? '')"
    >
      <span class="ui:text-end ui:font-mono ui:text-name ui:font-medium ui:inline-6">{{
        number
      }}</span>
      <span class="ui:inline-flex ui:items-center ui:gap-1.5 ui:text-small">
        <TypeIcon :type="type" :class="['ui:block-3.25 ui:inline-3.25', typeTone[type]]" />
        <template v-if="props.row.changes.type"
          >{{ props.row.changes.type.from }} → {{ props.row.changes.type.to }}</template
        >
        <template v-else>{{ type }}</template>
      </span>
      <span
        :class="[
          'ui:ellipsis ui:text-name ui:font-medium ui:text-fg ui:min-inline-0',
          type === 'markdown' ? '' : 'ui:font-mono',
        ]"
        >{{ name }}</span
      >
      <span class="ui:flex-1" />
      <span v-if="moved !== ''" class="ui:text-tiny ui:text-muted">moved {{ moved }}</span>
      <span
        v-for="count in counts"
        :key="count.text"
        :class="['ui:font-mono ui:text-tiny', count.tone]"
        >{{ count.text }}</span
      >
      <span
        v-if="badge !== null"
        data-part="badge"
        :class="['ui:rounded-small ui:px-1.5 ui:text-tiny ui:leading-5 ui:font-medium', badge.tone]"
        >{{ badge.text }}</span
      >
    </button>
    <div :class="['ui:py-2 ui:pe-3', band]">
      <MarkdownDiff
        v-if="markdown"
        :before="sameProse ? null : (props.row.before?.source ?? '')"
        :after="props.row.status === 'removed' ? null : (props.row.after?.source ?? '')"
        :side-by-side="props.sideBySide"
      />
      <LazyPane
        v-else-if="props.row.status === 'modified' && props.row.changes.source"
        :before="props.row.before?.source ?? ''"
        :after="props.row.after?.source ?? ''"
        :language="language"
        :side-by-side="props.sideBySide"
        :label="label"
      />
      <LazyPane v-else :text="source" :language="language" :side-by-side="false" :label="label" />
    </div>
    <OutputsDiff
      v-if="props.outputs && props.row.changes.outputs"
      :change="props.row.changes.outputs"
    />
    <dl
      v-if="props.metadata && props.row.changes.meta"
      class="ui:m-0 ui:grid ui:grid-cols-[auto_1fr] ui:gap-x-3 ui:border-bs ui:border-border ui:px-3 ui:py-1.5 ui:font-mono ui:text-tiny"
    >
      <template v-for="change in props.row.changes.meta" :key="change.key">
        <dt class="ui:text-muted">{{ change.key }}</dt>
        <dd class="ui:m-0 ui:ellipsis ui:text-fg-2">
          <span class="ui:text-err-text">{{ shown(change.from) }}</span> →
          <span class="ui:text-ok-text">{{ shown(change.to) }}</span>
        </dd>
      </template>
    </dl>
  </article>
</template>
