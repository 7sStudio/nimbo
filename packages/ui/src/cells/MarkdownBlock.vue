<!-- MarkdownBlock: a markdown cell rendered: the same block as a code cell, its header row saying "rendered", then the sanitized prose on white, its text starting on the same edge as the code. On hover, focus or selection its header row shows Edit, move up, move down and more; its fold arrow is always there, and folded (W) the cell is its header row alone, which says how many lines it holds. Enter, a double click or Edit opens its editor. -->
<script setup lang="ts">
import { ChevronDown, ChevronRight } from "@lucide/vue";
import { computed, shallowRef } from "vue";

import { loadMarkdown } from "../editor/markdown";
import type { CardPage, CardState } from "./card";
import CellHead from "./CellHead.vue";
import type { CellModel } from "./models";

const props = defineProps<{
  cell: CellModel;
  /** The text shown: the cell's source, or what was typed and is not sent yet. */
  source: string;
  page: CardPage;
  menu: CardState["menu"];
  /** Its text has a heading, so it opens a section (store/sections.ts). */
  section?: boolean;
  /** The cells its collapsed section hides; 0 when it is open or holds none. */
  hidden?: number;
}>();
const emit = defineEmits<{ edit: []; command: [id: string, args?: Record<string, unknown>] }>();
const render = shallowRef<((source: string) => string) | null>(null);
void loadMarkdown().then((loaded) => {
  render.value = loaded;
});
const html = computed(() => render.value?.(props.source) ?? "");
const folded = computed(() => props.cell.folded);
/** Folded, the name column says what is inside. */
const about = computed(() => (folded.value ? props.cell.inside : props.cell.about));
const collapsed = computed(() => props.cell.meta.headingCollapsed === true);
const toggleSection = () => {
  if (!props.page.off) emit("command", "ui.section.toggle");
};
</script>

<template>
  <!-- eslint-disable vue/no-v-html -- the prose is sanitized by DOMPurify (editor/render.ts) before it is set -->
  <article
    data-part="markdown"
    :data-selected="props.cell.selected ? '' : undefined"
    :data-current="props.cell.current ? '' : undefined"
    :data-folded="folded ? '' : undefined"
    class="ui:group/cell ui:cell-block ui:flex ui:flex-col ui:min-inline-0"
    @dblclick="emit('edit')"
  >
    <CellHead
      :cell="props.cell"
      :about="about"
      :mac="props.page.mac"
      :off="props.page.off"
      :menu="props.menu"
      @dblclick.stop
      @command="(id, args) => emit('command', id, args)"
    />
    <div
      v-if="!folded"
      class="ui:relative ui:bg-sheet ui:ps-(--cell-inset) ui:pe-6 ui:pbs-3 ui:pbe-3.5"
    >
      <button
        v-if="props.section"
        type="button"
        data-part="section-toggle"
        :aria-label="collapsed ? 'Expand section' : 'Collapse section'"
        :aria-expanded="!collapsed"
        :title="collapsed ? 'Expand section' : 'Collapse section'"
        :disabled="props.page.off"
        :class="[
          'ui:absolute ui:inset-s-[calc(var(--cell-inset)-1.75rem)] ui:inset-bs-3.5 ui:flex ui:cursor-pointer ui:items-center ui:justify-center ui:rounded-control ui:border-0 ui:bg-transparent ui:p-0 ui:text-faint ui:block-5 ui:inline-5 ui:hover:bg-well ui:hover:text-fg-2 ui:disabled:cursor-default',
          collapsed
            ? ''
            : 'ui:opacity-0 ui:group-hover/cell:opacity-100 ui:group-data-selected/cell:opacity-100 ui:focus-visible:opacity-100',
        ]"
        @click.stop="toggleSection"
        @dblclick.stop
      >
        <component
          :is="collapsed ? ChevronRight : ChevronDown"
          class="ui:block-3.5 ui:inline-3.5"
          aria-hidden="true"
        />
      </button>
      <div
        v-if="props.source.trim() !== ''"
        class="ui:prose"
        :data-rendered="render !== null ? '' : undefined"
        v-html="html"
      />
      <p v-else class="ui:m-0 ui:text-name ui:text-muted">
        Empty markdown cell. Press Enter or double click to write.
      </p>
    </div>
    <button
      v-if="(props.hidden ?? 0) > 0"
      type="button"
      data-part="section-hidden"
      :disabled="props.page.off"
      class="ui:flex ui:cursor-pointer ui:items-center ui:gap-1.5 ui:border-0 ui:border-bs ui:border-border ui:bg-sheet ui:ps-(--cell-inset) ui:text-start ui:text-name ui:text-muted ui:block-7 ui:hover:text-fg-2 ui:disabled:cursor-default"
      @click.stop="toggleSection"
      @dblclick.stop
    >
      {{ props.hidden }} {{ props.hidden === 1 ? "cell" : "cells" }} hidden
    </button>
  </article>
</template>
