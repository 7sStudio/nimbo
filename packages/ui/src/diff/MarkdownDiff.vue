<!-- MarkdownDiff: a markdown cell's change rendered, as ReviewNB and GitNotebooks show prose: the source cut into blocks, the blocks diffed (notebookRows.ts blockDiff) and each drawn with the page's own sanitizing renderer, a removed block on the red band and an added one on the green; side by side the old blocks left and the new right, inline one after the other. -->
<script setup lang="ts">
import { computed, ref, watchEffect } from "vue";

import { loadMarkdown } from "../editor/markdown";
import type { Block } from "./notebookRows";
import { blockDiff, blockRows } from "./notebookRows";

const props = defineProps<{ before: string | null; after: string | null; sideBySide: boolean }>();
const render = ref<((source: string) => string) | null>(null);
// Side effect: the renderer is a chunk of its own, loaded on first use.
watchEffect(() => {
  if (render.value === null) void loadMarkdown().then((made) => (render.value = made));
});
const blocks = computed(() => blockDiff(props.before ?? "", props.after ?? ""));
const rows = computed(() => blockRows(blocks.value));
const tone = (block: Block) =>
  block.kind === "removed"
    ? "ui:bg-[color-mix(in_oklch,var(--err)_12%,transparent)] ui:shadow-[inset_0.1875rem_0_var(--err)]"
    : block.kind === "added"
      ? "ui:bg-[color-mix(in_oklch,var(--ok)_12%,transparent)] ui:shadow-[inset_0.1875rem_0_var(--ok)]"
      : "";
const html = (block: Block) => render.value?.(block.text) ?? "";
const single = computed(() => props.before === null || props.after === null);
</script>

<template>
  <!-- eslint-disable vue/no-v-html -- the prose is sanitized by DOMPurify (editor/render.ts) before it is set -->
  <div
    data-testid="markdown-diff"
    :class="[
      'ui:ps-9',
      props.sideBySide && !single
        ? 'ui:grid ui:grid-cols-2 ui:gap-x-4 ui:gap-y-1'
        : 'ui:flex ui:flex-col',
    ]"
  >
    <template v-if="props.sideBySide && !single">
      <template v-for="(row, at) in rows" :key="at">
        <div
          :class="['ui:prose ui:px-2 ui:min-inline-0', row.left ? tone(row.left) : '']"
          v-html="row.left ? html(row.left) : ''"
        />
        <div
          :class="['ui:prose ui:px-2 ui:min-inline-0', row.right ? tone(row.right) : '']"
          v-html="row.right ? html(row.right) : ''"
        />
      </template>
    </template>
    <template v-else>
      <div
        v-for="(block, at) in blocks"
        :key="at"
        :class="['ui:prose ui:mbe-1 ui:px-2', single ? '' : tone(block)]"
        v-html="html(block)"
      />
    </template>
  </div>
</template>
