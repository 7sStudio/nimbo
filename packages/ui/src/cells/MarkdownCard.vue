<!-- MarkdownCard: a markdown cell while it is edited: the same block as a code cell, its header row saying "editing" and how to render it back, then the markdown editor on white. Shift Enter, Cmd Enter, Esc or the header's Render renders it. A press on the header leaves the focus in the editor (Safari and Firefox do not focus a clicked button), so the editor stays open under the click; Tab still reaches the buttons. -->
<script setup lang="ts">
import type { Leave } from "../editor/keymap";
import type { CardPage, CardState } from "./card";
import CellEditor from "./CellEditor.vue";
import CellHead from "./CellHead.vue";
import type { CellModel } from "./models";

const props = defineProps<{ cell: CellModel; page: CardPage; state: CardState }>();
const emit = defineEmits<{
  command: [id: string, args?: Record<string, unknown>];
  change: [text: string];
  focus: [];
  blur: [];
  leave: [edge: Leave];
  caret: [line: number, column: number];
}>();
</script>

<template>
  <article
    data-part="markdown-card"
    data-selected=""
    data-current=""
    data-editing=""
    class="ui:group/cell ui:cell-block ui:flex ui:flex-col ui:min-inline-0 ui:motion-safe:animate-enter"
  >
    <CellHead
      :cell="props.cell"
      :about="''"
      :mac="props.page.mac"
      :off="props.page.off"
      :menu="props.state.menu"
      @mousedown.prevent
      @command="(id, args) => emit('command', id, args)"
    />
    <CellEditor
      :source="props.state.draft ?? props.cell.source"
      language="markdown"
      :word-wrap="true"
      :tab-size="props.page.tabSize"
      :label="`Cell ${props.cell.number} source`"
      :read-only="props.page.off"
      :editing="props.cell.editing"
      :caret="props.state.caret"
      :pending="props.state.draft !== undefined"
      :syntax="null"
      :words="props.page.words"
      @change="(text) => emit('change', text)"
      @focus="emit('focus')"
      @blur="emit('blur')"
      @leave="(edge) => emit('leave', edge)"
      @caret="(line, column) => emit('caret', line, column)"
    />
  </article>
</template>
