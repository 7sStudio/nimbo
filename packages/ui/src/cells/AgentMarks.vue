<!-- AgentMarks: around a cell's code, the agent edit no one reviewed yet: it gives the editor the violet numbers of the lines the agent changed (none while something typed is unsent, the text then differing from what the edit describes), and shows the edit's card (AgentEditCard) while the pointer rests on them, inside the cell: a cell too short for it gets the room it needs under its code while it shows. The keyboard reaches it through a button of the cell's own named after the edit, before the code and seen only while it has the focus (the editor's gutter is hidden from assistive technology): its focus rings the first violet number and shows the card, Enter takes the focus into the card, Escape brings it back. -->
<script setup lang="ts">
import { computed, ref, watch } from "vue";

import type { AgentLines } from "../editor/setup";
import AgentEditCard from "./AgentEditCard.vue";
import { changedBy, markedLines, pendingEdit } from "./agentEdit";
import type { CellModel } from "./models";
import { useAgentCard } from "./useAgentCard";

const props = defineProps<{
  cell: CellModel;
  /** Something typed in the editor is not sent yet. */
  draft: boolean;
  off: boolean;
}>();
const emit = defineEmits<{ command: [id: string] }>();
defineSlots<{ default: (scope: { agentLines: AgentLines | null }) => unknown }>();

const pending = computed(() => pendingEdit(props.cell.meta));
const agentLines = computed((): AgentLines | null => {
  const edit = pending.value;
  if (edit === null || props.draft) return null;
  const words = changedBy(edit);
  const label = `${words.charAt(0).toUpperCase()}${words.slice(1)}: show the edit`;
  return { lines: markedLines(edit.review.lines), label };
});
const code = ref<HTMLElement | null>(null);
const card = useAgentCard(code);
const top = card.top;
const room = card.room;
// Side effect: the card goes with the edit (reviewed, reverted, or the text typed over).
watch(agentLines, (now) => {
  if (now === null) card.close();
});
</script>

<template>
  <div
    ref="code"
    class="ui:relative ui:flex ui:flex-col ui:bg-sheet"
    :style="room > 0 ? { paddingBlockEnd: `${String(room)}px` } : undefined"
    @mouseover="card.over"
    @mouseleave="card.leave"
    @focusin="card.focusIn"
    @focusout="card.focusOut"
    @keydown="card.key"
  >
    <button
      v-if="agentLines !== null"
      type="button"
      data-part="agent-mark"
      class="ui:visually-hidden"
      @click="card.enter"
    >
      {{ agentLines.label }}
    </button>
    <slot :agent-lines="agentLines" />
    <AgentEditCard
      v-if="pending !== null && agentLines !== null && top !== null"
      :edit="pending"
      :source="props.cell.source"
      :number="props.cell.number"
      :off="props.off"
      :top="top"
      @command="(id) => emit('command', id)"
    />
  </div>
</template>
