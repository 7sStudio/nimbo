<!-- AgentEditCard: the card of an agent edit no one reviewed yet, inside the cell over the code's right side: who changed which lines, when and over which client, the changed lines against the code before with a line of context (the removed ones on red, the added on green, each with its line number), then Revert, Mark reviewed and Open full diff. A view-only tab shows the diff and Open full diff only, and says why. -->
<script setup lang="ts">
import type { DiffLine } from "@jsnb/core";
import { diffHunks, lineDiff } from "@jsnb/core";
import { Bot } from "@lucide/vue";
import { computed } from "vue";

import type { PendingEdit } from "./agentEdit";
import { linesOf, overOf, whenOf, whoOf } from "./agentEdit";

const props = defineProps<{
  edit: PendingEdit;
  source: string;
  number: number;
  /** The page cannot write here (a view-only tab, no connection). */
  off: boolean;
  top: number;
}>();
const emit = defineEmits<{ command: [id: string] }>();

/** The card shows this many diff lines; the full diff has the rest. */
const shownLines = 12;

type Row = DiffLine | { readonly kind: "gap" };
const rows = computed((): readonly Row[] => {
  const hunks = diffHunks(lineDiff(props.edit.review.previousSource, props.source), 1);
  return hunks.flatMap((hunk, at): Row[] => (at === 0 ? [...hunk] : [{ kind: "gap" }, ...hunk]));
});
const shown = computed(() => rows.value.slice(0, shownLines));
const more = computed(
  () =>
    rows.value.slice(shownLines).filter((row) => row.kind === "added" || row.kind === "removed")
      .length,
);
const title = computed(() => `${whoOf(props.edit)} changed ${linesOf(props.edit.review.lines)}`);
const meta = computed(() =>
  [whenOf(props.edit.at), overOf(props.edit), "not reviewed"]
    .filter((part) => part !== "")
    .join(", "),
);
const numberOf = (row: DiffLine) => (row.kind === "removed" ? row.before : row.after);
const sign = { same: " ", removed: "-", added: "+" } as const;
const tone = {
  same: "ui:text-pop-muted",
  removed: "ui:bg-diff-removed ui:text-diff-removed-fg",
  added: "ui:bg-diff-added ui:text-diff-added-fg",
} as const;
const action =
  "ui:inline-flex ui:cursor-pointer ui:items-center ui:rounded-none ui:border ui:border-transparent ui:bg-pop-fg/12 ui:px-2.25 ui:text-meta ui:font-medium ui:text-pop-fg ui:block-5.5 ui:hover:bg-pop-fg/20 ui:focus-visible:border-pop-fg";
</script>

<template>
  <section
    data-part="agent-card"
    role="group"
    :aria-label="`Agent edit of cell ${String(props.number)}`"
    :style="{ insetBlockStart: `${String(props.top)}px` }"
    class="ui:absolute ui:inset-e-3 ui:z-(--z-panel) ui:flex ui:flex-col ui:gap-1.75 ui:rounded-none ui:bg-pop ui:px-2.75 ui:pbs-2.25 ui:pbe-2.5 ui:text-meta ui:leading-ui ui:text-pop-fg ui:shadow-pop ui:inline-[min(35.5rem,calc(100%-1.5rem))]"
  >
    <p class="ui:m-0 ui:flex ui:items-center ui:gap-3 ui:text-pop-muted ui:min-inline-0">
      <b
        class="ui:inline-flex ui:shrink-0 ui:items-center ui:gap-1.5 ui:font-semibold ui:text-pop-fg"
        ><Bot class="ui:text-agent-pop ui:block-3.25 ui:inline-3.25" aria-hidden="true" />{{
          title
        }}</b
      >
      <span class="ui:ellipsis ui:min-inline-0">{{ meta }}</span>
    </p>
    <ol
      aria-label="The changed lines"
      class="ui:m-0 ui:list-none ui:overflow-clip ui:p-0 ui:font-mono ui:text-[0.65625rem] ui:leading-[1.0625rem]"
    >
      <li
        v-for="(row, at) in shown"
        :key="at"
        :class="[
          'ui:flex ui:px-1 ui:whitespace-pre',
          row.kind === 'gap' ? 'ui:text-pop-muted' : tone[row.kind],
        ]"
      >
        <template v-if="row.kind === 'gap'">…</template>
        <template v-else>
          <span class="ui:shrink-0 ui:pe-2.5 ui:text-end ui:opacity-60 ui:inline-6">{{
            numberOf(row)
          }}</span>
          <span class="ui:ellipsis ui:min-inline-0"
            ><span class="ui:visually-hidden">{{
              row.kind === "same" ? "kept: " : `${row.kind}: `
            }}</span
            ><span aria-hidden="true">{{ sign[row.kind] }} </span>{{ row.text }}</span
          >
        </template>
      </li>
    </ol>
    <p v-if="more > 0" class="ui:m-0 ui:text-pop-muted">
      {{ more }} more changed {{ more === 1 ? "line" : "lines" }} in the full diff
    </p>
    <div class="ui:flex ui:flex-wrap ui:items-center ui:gap-1.5">
      <template v-if="!props.off">
        <button type="button" :class="action" @click="emit('command', 'ui.cell.revert')">
          Revert
        </button>
        <button type="button" :class="action" @click="emit('command', 'cell.markReviewed')">
          Mark reviewed
        </button>
      </template>
      <button type="button" :class="action" @click="emit('command', 'ui.cell.agentDiff')">
        Open full diff
      </button>
      <span v-if="props.off" class="ui:text-pop-muted"
        >View only here: revert or mark reviewed from the tab that holds the page.</span
      >
    </div>
  </section>
</template>
