<!-- One grid cell: a leaf's tokens with find's matches marked, a container's one-line preview, nothing when absent. Dates
stay compact: a unix time shows as its date, and every date has both forms in the cell's title; links,
"View as tree" for JSON and add-on hints show as in the tree, hooks given the cell's path. -->
<script setup lang="ts">
import type { Path } from "@jsnb/core";
import { computed } from "vue";

import type { LeafOptions } from "../model/leaf.js";
import { leafText } from "../model/leaf.js";
import type { TextRange } from "../model/matcher.js";
import type { Cell } from "../model/records.js";
import { isContainer } from "../model/wire.js";
import { parseJsonText } from "../model/hints.js";
import { useViewer } from "./context.js";
import { cellHints, cellTokens } from "./gridView.js";
import HintList from "./HintList.vue";
import { linkOf } from "./rowView.js";
import TokenText from "./TokenText.vue";
import { link } from "./classes/link.js";

const props = defineProps<{
  readonly cell: Cell;
  /** The cell's path from the grid's value: `[row, key]`. */
  readonly path: Path;
  readonly leaf: LeafOptions;
  readonly ranges?: readonly TextRange[] | undefined;
}>();
const viewer = useViewer();
const hints = computed(() => cellHints(props.cell, viewer.hints.value, props.path));
const href = computed(() => linkOf(hints.value.others));
/** The raw text find's ranges index: a string's own text, another leaf's text. */
const text = computed(() =>
  props.cell.present && !isContainer(props.cell.kind)
    ? leafText(props.cell.node, props.cell.kind, props.leaf)
    : undefined,
);
/** A unix time's date in place of the number, unless find marks a match in the number. */
const date = computed(() => ((props.ranges?.length ?? 0) > 0 ? undefined : hints.value.date));
const title = computed(() => {
  const time = hints.value.time;
  return time === undefined ? undefined : `${text.value ?? ""}, ${time.tooltip}`;
});

function viewTree(): void {
  const node = props.cell.present ? props.cell.node : undefined;
  const parsed = typeof node === "string" ? parseJsonText(node) : undefined;
  if (parsed) viewer.openFullscreen(parsed.json, []);
}
</script>

<template>
  <div
    role="gridcell"
    data-part="grid-cell"
    class="ov:overflow-clip ov:px-2 ov:text-ellipsis ov:whitespace-nowrap"
    :data-absent="cell.present ? undefined : ''"
    :title="title"
  >
    <span v-if="date !== undefined" data-token="typ" class="ov:text-typ">{{ date }}</span>
    <component
      :is="href ? 'a' : 'span'"
      v-else
      :href="href"
      :target="href && '_blank'"
      :rel="href && 'noopener noreferrer'"
      :data-part="href && 'link'"
      :class="href && link"
      @click="href && $event.stopPropagation()"
    >
      <TokenText
        :tokens="cellTokens(cell, leaf)"
        :ranges="ranges"
        :text="text"
        :quoted="cell.present && cell.kind === 'string'"
      />
    </component>
    <span v-if="hints.others.length > 0" data-part="cell-hints" @click.stop>
      <HintList :hints="hints.others" @view-tree="viewTree" />
    </span>
  </div>
</template>
