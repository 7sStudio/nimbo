<!-- AgentView: the agent edits waiting for review, one row per cell: its number and name, the lines the agent changed, who made the edit, over which client and when; a click on the row goes to the cell, and the row's Mark reviewed, Revert and Full diff act on it there (not in a view-only tab): in words, shown on the row of the selected cell, on a hovered row and on a row that holds the keyboard's focus, and in the tab order on every row. "Show only these" keeps the notebook to these cells until it is pressed again. A cell leaves the list once its edit is reviewed, reverted, or edited by you. -->
<script setup lang="ts">
import { computed } from "vue";

import { plural } from "../app/models";
import { linesOf, overOf, pendingEdit, whenOf, whoOf } from "../cells/agentEdit";
import { useCellNames } from "../cells/names";
import { useDispatcher } from "../commands/dispatch";
import { useNotebookStore } from "../store/notebook";
import { useUiStore } from "../store/ui";
import ViewHead from "./ViewHead.vue";
import { note, rowAction, rowButton, wordButton } from "./rows";

const dispatcher = useDispatcher();
const store = useNotebookStore();
const ui = useUiStore();
const names = useCellNames();
const rows = computed(() =>
  store.cellsInOrder.flatMap((cell, at) => {
    const edit = pendingEdit(cell.meta);
    if (edit === null) return [];
    const when = whenOf(edit.at);
    return [
      {
        id: cell.id,
        number: at + 1,
        name: names.value.get(cell.id) ?? "",
        lines: linesOf(edit.review.lines),
        who: whoOf(edit),
        how: [overOf(edit), when].filter((part) => part !== "").join(", "),
      },
    ];
  }),
);
/** This tab may revert and mark reviewed (not view only, connected). */
const writes = computed(() => dispatcher.available("cell.markReviewed", { cell: "c_000000" }));
/** A row's actions: hidden at rest like any row's, shown on the selected cell's row too. */
const action = [wordButton, rowAction, "ui:group-data-current/row:opacity-100"];
function act(cell: string, id: string): void {
  ui.select(cell);
  void dispatcher.dispatch(id);
}
</script>

<template>
  <ViewHead id="side-title" title="Agent" region="side" />
  <div class="ui:flex ui:flex-1 ui:flex-col ui:gap-1 ui:overflow-y-auto ui:min-block-0">
    <div v-if="rows.length > 0" class="ui:flex ui:items-center ui:gap-2 ui:px-1 ui:block-7">
      <span class="ui:font-semibold">{{ plural(rows.length, "edit") }} to review</span>
      <button
        type="button"
        :aria-pressed="ui.filter === 'agentEdits'"
        :class="[wordButton, 'ui:ms-auto ui:aria-pressed:bg-sheet']"
        @click="dispatcher.dispatch('ui.filter.agentEdits')"
      >
        Show only these
      </button>
    </div>
    <ul aria-label="Agent edits to review" class="ui:m-0 ui:flex ui:list-none ui:flex-col ui:p-0">
      <li
        v-for="row in rows"
        :key="row.id"
        :data-current="ui.selected === row.id ? '' : undefined"
        class="ui:group/row ui:flex ui:flex-col"
      >
        <button
          type="button"
          :aria-current="ui.selected === row.id ? 'true' : undefined"
          :class="[rowButton, 'ui:items-start ui:py-1 ui:block-auto']"
          @click="dispatcher.dispatch('ui.select', { cell: row.id })"
        >
          <span
            class="ui:shrink-0 ui:text-end ui:font-mono ui:text-tiny ui:text-muted ui:inline-4"
            >{{ row.number }}</span
          >
          <span class="ui:flex ui:flex-col ui:min-inline-0">
            <span class="ui:ellipsis ui:font-mono ui:text-fg">{{ row.name }}</span>
            <span class="ui:text-tiny ui:font-normal ui:text-fg-2" data-part="lines">{{
              row.lines
            }}</span>
            <span class="ui:text-tiny ui:font-normal ui:text-muted" data-part="edit"
              ><span class="ui:text-agent">{{ row.who }}</span> {{ row.how }}</span
            >
          </span>
        </button>
        <span v-if="writes" class="ui:flex ui:gap-1 ui:ps-6.5 ui:pbe-1">
          <button
            type="button"
            :class="action"
            :aria-label="`Mark the edit of cell ${String(row.number)} reviewed`"
            @click="act(row.id, 'cell.markReviewed')"
          >
            Mark reviewed
          </button>
          <button
            type="button"
            :class="action"
            :aria-label="`Revert the edit of cell ${String(row.number)}`"
            @click="act(row.id, 'ui.cell.revert')"
          >
            Revert
          </button>
          <button
            type="button"
            :class="action"
            :aria-label="`Open the full diff of cell ${String(row.number)}`"
            @click="act(row.id, 'ui.cell.agentDiff')"
          >
            Full diff
          </button>
        </span>
      </li>
    </ul>
    <p v-if="rows.length === 0" :class="note">No pending edits</p>
  </div>
</template>
