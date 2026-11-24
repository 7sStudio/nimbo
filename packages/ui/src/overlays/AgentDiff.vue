<!-- AgentDiff: Open full diff: the whole cell, the code before the agent's edits no one reviewed against the code now, line by line with both line numbers, the removed lines on red and the added on green, on the floating layer's dark surface the card uses; Revert and Mark reviewed (not in a view-only tab) and Close. It closes by itself once the edit is reviewed or reverted. -->
<script setup lang="ts">
import type { DiffLine } from "@jsnb/core";
import { lineDiff } from "@jsnb/core";
import { computed, watch } from "vue";

import { linesOf, overOf, pendingEdit, whenOf, whoOf } from "../cells/agentEdit";
import { useDispatcher } from "../commands/dispatch";
import Button from "../primitives/button/Button.vue";
import type { Overlay } from "../store/overlay";
import { useNotebookStore } from "../store/notebook";
import { useUiStore } from "../store/ui";
import OverlayDialog from "./OverlayDialog.vue";

const props = defineProps<{ overlay: Extract<Overlay, { kind: "agentDiff" }> }>();
const dispatcher = useDispatcher();
const notebook = useNotebookStore();
const ui = useUiStore();
const cell = computed(() => notebook.byId.get(props.overlay.cell));
const edit = computed(() => (cell.value === undefined ? null : pendingEdit(cell.value.meta)));
const number = computed(
  () => notebook.cellsInOrder.findIndex((each) => each.id === props.overlay.cell) + 1,
);
// Side effect: reviewed or reverted, there is nothing left to show.
watch(edit, (now) => {
  if (now === null && ui.overlay === props.overlay) ui.overlay = null;
});
const rows = computed((): readonly DiffLine[] =>
  edit.value === null || cell.value === undefined
    ? []
    : lineDiff(edit.value.review.previousSource, cell.value.source),
);
const title = computed(() =>
  edit.value === null
    ? `Cell ${String(number.value)}`
    : `Cell ${String(number.value)}: ${whoOf(edit.value)} changed ${linesOf(edit.value.review.lines)}`,
);
const description = computed(() =>
  edit.value === null
    ? ""
    : [whenOf(edit.value.at), overOf(edit.value), "not reviewed"].filter(Boolean).join(", "),
);
const writes = computed(() => dispatcher.available("ui.cell.revert"));
const sign = { same: " ", removed: "-", added: "+" } as const;
const tone = {
  same: "ui:text-pop-muted",
  removed: "ui:bg-diff-removed ui:text-diff-removed-fg",
  added: "ui:bg-diff-added ui:text-diff-added-fg",
} as const;
function act(id: string): void {
  ui.overlay = null;
  ui.select(props.overlay.cell);
  void dispatcher.dispatch(id);
}
</script>

<template>
  <OverlayDialog
    :overlay="props.overlay"
    :title="title"
    :description="description"
    width="ui:max-inline-[min(60rem,calc(100%-2rem))] ui:rounded-none"
  >
    <div
      data-testid="agent-diff"
      class="ui:overflow-auto ui:rounded-none ui:bg-pop ui:py-1.5 ui:font-mono ui:text-small ui:leading-[1.3rem] ui:max-block-[60vh]"
    >
      <table class="ui:border-collapse ui:inline-full" aria-label="The cell before and now">
        <thead class="ui:visually-hidden">
          <tr>
            <th scope="col">Line before</th>
            <th scope="col">Line now</th>
            <th scope="col">Text</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, at) in rows" :key="at" :class="tone[row.kind]">
            <td class="ui:ps-2 ui:pe-2 ui:text-end ui:align-top ui:opacity-60 ui:inline-10">
              {{ row.kind === "added" ? "" : row.before }}
            </td>
            <td class="ui:pe-3 ui:text-end ui:align-top ui:opacity-60 ui:inline-10">
              {{ row.kind === "removed" ? "" : row.after }}
            </td>
            <td class="ui:pe-3 ui:break-all ui:whitespace-pre-wrap">
              <span class="ui:visually-hidden">{{
                row.kind === "same" ? "kept: " : `${row.kind}: `
              }}</span
              ><span aria-hidden="true">{{ sign[row.kind] }} </span>{{ row.text }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <template #footer>
      <template v-if="writes">
        <Button @click="act('ui.cell.revert')">Revert</Button>
        <Button @click="act('cell.markReviewed')">Mark reviewed</Button>
      </template>
      <Button @click="ui.overlay = null">Close</Button>
    </template>
  </OverlayDialog>
</template>
