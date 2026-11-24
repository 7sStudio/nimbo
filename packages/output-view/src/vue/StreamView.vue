<!-- stdout and stderr (gallery card 3): ANSI colors and OSC 8 links, monospace, wrap and timestamps as toggles, the
last 2,000 lines until "Show all", and the tail followed while the cell runs. -->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";

import { thousands } from "../model/preview.js";
import { lineCount, runAttrs, styledLines, tailLines } from "./terminal.js";
import TextButton from "./TextButton.vue";
import { run } from "./classes/run.js";

const props = defineProps<{
  readonly text: string;
  readonly stream: "stdout" | "stderr";
  readonly running?: boolean | undefined;
  /** One time per line when the host records them (`13:41:02`); shown when `showTimes`. */
  readonly timestamps?: readonly string[] | undefined;
  readonly wrap?: boolean | undefined;
  readonly showTimes?: boolean | undefined;
  /** Lines shown from the end until "Show all" (default 2,000). */
  readonly tail?: number | undefined;
}>();
const all = ref(false);
const total = computed(() => lineCount(props.text));
const lines = computed(() =>
  styledLines(props.text, all.value ? undefined : (props.tail ?? tailLines)),
);
const hidden = computed(() => total.value - lines.value.length);
const timeOf = (index: number): string | undefined => props.timestamps?.[hidden.value + index];
const scroller = ref<HTMLElement | null>(null);

/** Whether the view sits at its end, within one line, so new lines keep it there (a reader who scrolled up is left
 * alone). The line is the stream's own line height, read from its style. */
const atEnd = (element: HTMLElement): boolean =>
  element.scrollHeight - element.scrollTop - element.clientHeight <
  (Number.parseFloat(getComputedStyle(element).lineHeight) || 0) + 1;

// Side effect: while the cell runs, new output scrolls into view if the reader was at the end.
watch(
  () => props.text,
  async () => {
    const element = scroller.value;
    if (!props.running || element === null || !atEnd(element)) return;
    await nextTick();
    element.scrollTop = element.scrollHeight;
  },
  { flush: "pre" },
);
</script>

<template>
  <div
    ref="scroller"
    data-part="stream"
    class="ov:group/stream ov:max-block-[var(--max-height,none)] ov:overflow-auto ov:px-2 ov:py-1 ov:font-mono ov:text-value ov:leading-code ov:text-fg ov:data-[stream=stderr]:text-err"
    :data-stream="stream"
    :data-wrap="wrap ? '' : undefined"
    tabindex="0"
    :aria-label="stream"
  >
    <TextButton v-if="hidden > 0" @click="all = true">
      Show {{ thousands(hidden) }} earlier lines
    </TextButton>
    <!-- a line: the time, when shown, beside the text (gap, not a margin) -->
    <div
      v-for="(line, index) in lines"
      :key="hidden + index"
      data-part="stream-line"
      class="ov:flex ov:min-block-lh ov:gap-3"
    >
      <time
        v-if="showTimes && timeOf(index)"
        data-part="stream-time"
        class="ov:flex-none ov:text-fg-2"
        >{{ timeOf(index) }}</time
      >
      <span
        data-part="stream-text"
        class="ov:min-inline-0 ov:whitespace-pre ov:group-data-wrap/stream:wrap-anywhere ov:group-data-wrap/stream:whitespace-pre-wrap"
        ><template v-for="{ span, start } in line" :key="start"
          ><a
            v-if="span.link"
            v-bind="runAttrs(span)"
            :class="run"
            :href="span.link"
            target="_blank"
            rel="noopener noreferrer"
            >{{ span.text }}</a
          ><span v-else v-bind="runAttrs(span)" :class="run">{{ span.text }}</span></template
        ></span
      >
    </div>
  </div>
</template>
