<!-- Syntax tokens as spans carrying their token name (theme.css colors them), with find's matches marked in `text`. -->
<script setup lang="ts">
import { computed } from "vue";

import type { Token } from "../model/leaf.js";
import type { TextRange } from "../model/matcher.js";
import { escaped, segments, withStarts } from "./marks.js";
import { tokenColor } from "./classes/tokens.js";

const props = defineProps<{
  readonly tokens: readonly Token[];
  /** With ranges: the raw text of the first token (a key's name, a leaf's text) that the ranges index, shown marked
   * in its place (inside quotes when `quoted`); the other tokens follow unchanged. */
  readonly ranges?: readonly TextRange[] | undefined;
  readonly text?: string | undefined;
  readonly quoted?: boolean | undefined;
}>();

const marked = computed(() =>
  props.ranges && props.text !== undefined && props.ranges.length > 0
    ? segments(props.text, props.ranges)
    : undefined,
);
const kind = computed(() => props.tokens[0]?.kind ?? "text");
// Keyed by their offsets in the text, stable ids for the v-fors.
const placed = computed(() => withStarts(props.tokens));
const rest = computed(() => placed.value.slice(1));
</script>

<template>
  <span v-if="marked" data-part="tokens"
    ><span :data-token="kind" :class="tokenColor[kind]"
      >{{ quoted ? '"' : ""
      }}<template v-for="run in marked" :key="run.start"
        ><mark v-if="run.mark" data-part="match" class="ov:rounded-mark ov:bg-match ov:text-fg">{{
          quoted ? escaped(run.text) : run.text
        }}</mark
        ><template v-else>{{ quoted ? escaped(run.text) : run.text }}</template></template
      >{{ quoted ? '"' : "" }}</span
    ><span
      v-for="token in rest"
      :key="token.start"
      :data-token="token.kind"
      :class="tokenColor[token.kind]"
      >{{ token.text }}</span
    ></span
  >
  <span v-else data-part="tokens"
    ><span
      v-for="token in placed"
      :key="token.start"
      :data-token="token.kind"
      :class="tokenColor[token.kind]"
      >{{ token.text }}</span
    ></span
  >
</template>
