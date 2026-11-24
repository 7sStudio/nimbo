<!-- One row of the tree (gallery card 1): chevron, key, value or container label, count, hints, the long-string fold,
"Load next 2,000" on a cut array, and copy value / copy path (and copy base64 for bytes) on the hovered or active
row, whose buttons Tab reaches from the tree. -->
<script setup lang="ts">
import { computed } from "vue";

import { hintsFor, parseJsonText } from "../model/hints.js";
import { leafText } from "../model/leaf.js";
import { plural, thousands } from "../model/preview.js";
import type { SearchMatch } from "../model/search.js";
import { loadLimit, moreAt } from "../model/slices.js";
import type { NodeRow } from "../model/tree.js";
import { isContainer, textField } from "../model/wire.js";
import { placeOf, useViewer } from "./context.js";
import Icon from "./Icon.vue";
import IconButton from "./IconButton.vue";
import HintList from "./HintList.vue";
import { closedCount, foldOf, keyTokens, leafOptions, linkOf, valueTokens } from "./rowView.js";
import TokenText from "./TokenText.vue";
import TextButton from "./TextButton.vue";
import { link } from "./classes/link.js";
import { metaText } from "./classes/meta.js";

const props = defineProps<{
  readonly row: NodeRow;
  /** The tree's value, which the row's path starts from. */
  readonly root: unknown;
  readonly matches?: readonly SearchMatch[] | undefined;
  readonly showActions: boolean;
  readonly unfolded: boolean;
}>();
const emit = defineEmits<{
  toggle: [deep: boolean];
  unfold: [];
  "copy-value": [];
  "copy-path": [];
}>();
const viewer = useViewer();
/** The chevron's 18 px box, and the leaf's empty slot of the same size that keeps keys in line. */
const chevron =
  "ov:inline-flex ov:inline-4.5 ov:block-4.5 ov:cursor-pointer ov:items-center ov:justify-center ov:rounded-box ov:border ov:border-transparent ov:bg-transparent ov:p-0 ov:text-muted ov:font-inherit";

/** The row's path in the output (in full screen, from the node shown): refs read it, hint hooks get it. */
const at = computed(() => {
  const { base } = placeOf(viewer, props.root);
  return base.length === 0 ? props.row.path : [...base, ...props.row.path];
});
const leaf = computed(() => leafOptions(viewer.hints.value.timeZone, at.value));
const hints = computed(() => hintsFor(props.row.value, viewer.hints.value, at.value));
const keyName = computed(() => (props.row.key.kind === "name" ? props.row.key.name : undefined));
const rangesIn = (where: "key" | "value") => props.matches?.find((m) => m.in === where)?.ranges;
const fold = computed(() => (props.unfolded ? undefined : foldOf(props.row.value, hints.value)));
const href = computed(() => linkOf(hints.value));
/** A bytes node's base64, for "copy base64" (bytes are a tree row with hex, length and copy). */
const base64 = computed(() =>
  props.row.kind === "bytes" ? textField(props.row.value, "base64") : undefined,
);
const more = computed(() =>
  props.row.kind === "truncated" && viewer.loadMore.value
    ? moreAt(props.root, props.row.path.slice(0, -1))
    : undefined,
);
/** The raw text find's value ranges index: a string's own text, any other leaf's text. */
const text = computed(() =>
  isContainer(props.row.kind) ? undefined : leafText(props.row.value, props.row.kind, leaf.value),
);
const quoted = computed(() => props.row.kind === "string");

function viewTree(): void {
  const parsed = typeof props.row.value === "string" ? parseJsonText(props.row.value) : undefined;
  if (parsed) viewer.openFullscreen(parsed.json, []);
}
async function loadMore(): Promise<void> {
  const offset = more.value?.offset;
  const load = viewer.loadMore.value;
  if (offset === undefined || load === undefined) return;
  await viewer.run(`Loading the next ${thousands(loadLimit)}`, (signal) =>
    load(props.row.path.slice(0, -1), offset, signal),
  );
}
</script>

<template>
  <!-- The chevron's target is 24 px wide and its row's full 20 px tall: its ::before reaches 3 px past the glyph to each
  side and 1 px above and below it to the row's edges. At the tree's 20 px pitch a taller target would reach into the
  next row, where a sibling's chevron sits under it: clicking the foot of one chevron would toggle the other. It sits
  above the key beside it (positioned, it paints over its static neighbours with no z-index), so the 3 px to its
  side are its own. -->
  <button
    v-if="row.hasChildren"
    type="button"
    tabindex="-1"
    aria-hidden="true"
    data-part="chevron"
    :class="chevron"
    class="ov:relative ov:before:absolute ov:before:-inset-x-1 ov:before:-inset-y-0.5 ov:before:content-[''] ov:hover:bg-surface-2 ov:hover:text-fg"
    @click.stop="emit('toggle', $event.metaKey || $event.ctrlKey)"
  >
    <Icon :name="row.expanded ? 'chevronDown' : 'chevronRight'" />
  </button>
  <span v-else data-part="chevron" :class="chevron" />
  <TokenText :tokens="keyTokens(row.key, leaf)" :ranges="rangesIn('key')" :text="keyName" />
  <a
    v-if="href"
    :href="href"
    target="_blank"
    rel="noopener noreferrer"
    data-part="link"
    :class="link"
    ><TokenText
      :tokens="valueTokens(row, leaf)"
      :ranges="rangesIn('value')"
      :text="text"
      :quoted="quoted"
  /></a>
  <template v-else-if="fold">
    <TokenText :tokens="[{ kind: 'str', text: `${JSON.stringify(fold.shown).slice(0, -1)}…` }]" />
    <TextButton part="hint-action" @click.stop="emit('unfold')">
      Show {{ plural(fold.hidden, "more character", "more characters") }}
    </TextButton>
  </template>
  <TokenText
    v-else
    :tokens="valueTokens(row, leaf)"
    :ranges="rangesIn('value')"
    :text="text"
    :quoted="quoted"
  />
  <span v-if="closedCount(row)" data-part="count" :class="metaText">{{ closedCount(row) }}</span>
  <TextButton v-if="more" part="hint-action" @click.stop="loadMore">
    Load next {{ thousands(loadLimit) }}
  </TextButton>
  <HintList v-if="hints.length > 0" :hints="hints" @view-tree="viewTree" />
  <span v-if="showActions" data-part="row-actions" class="ov:ms-auto ov:inline-flex ov:gap-0.5">
    <IconButton
      label="Copy value"
      icon="copy"
      shortcut="⌘C"
      size="row"
      @click.stop="emit('copy-value')"
    />
    <IconButton
      label="Copy path"
      icon="link"
      shortcut="⌘⇧C"
      size="row"
      @click.stop="emit('copy-path')"
    />
    <IconButton
      v-if="base64 !== undefined"
      label="Copy base64"
      icon="code"
      size="row"
      @click.stop="viewer.copy('base64', base64)"
    />
  </span>
</template>
