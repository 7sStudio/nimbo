<!-- RunError: the error a cell's last run ended with, under its outputs on the result's tone. A title row as Jupyter and VS Code print an error: a warning sign, the error's name and its message, Copy error at the right. the failing line of this cell quoted with its number in a tinted strip (a syntax error's with a caret under the fault and Jump), and everything else (the error's name, its fields, the stack with Jump, the raw object) behind a collapsed Details. A server cell that needs a client cell's name says the advice once: the line with "Switch this cell to client" takes the message's place. Never a cell's id: the card gives the error with its cells named "cell 2". -->
<script setup lang="ts">
import type { ErrorInfo } from "@jsnb/core";
import type { JumpTarget } from "@jsnb/output-view";
import { OutputView } from "@jsnb/output-view";
import { ChevronDown, ChevronRight, TriangleAlert } from "@lucide/vue";
import { computed, defineAsyncComponent, ref } from "vue";

import { wordButton } from "../panel/rows";
import { caretLine, detailsWords, errorText } from "./errorWords";

const SwitchPrompt = defineAsyncComponent(() => import("./SwitchPrompt.vue"));

const props = defineProps<{
  /** The cell's id, for Jump. */
  cell: string;
  error: ErrorInfo;
  /** The cell's text, whose failing line the strip quotes. */
  source: string;
  /** The line of this cell that threw, or where its syntax error is; null when the error names none. */
  line: number | null;
  /** A syntax error's column: the strip draws a caret under it and offers Jump. */
  col: number | null;
  /** The client cell a server cell needed (DefinedInClient): the switch line says it instead of the message. */
  inClient: { readonly name: string; readonly index: number } | null;
  /** Writes are off on this page: no switch. */
  off: boolean;
}>();
const emit = defineEmits<{
  command: [id: string, args?: Record<string, unknown>];
  jump: [target: JumpTarget];
  copyText: [text: string, what: string];
}>();

const syntax = computed(() => props.col !== null);
/** The message on the title line; a server cell that needs a client cell's name says the switch line instead. */
const message = computed(() => (props.inClient === null ? props.error.message : ""));
/** The quoted line: its number and text, and a syntax error's caret under the fault. */
const quoted = computed(() => {
  if (props.line === null) return null;
  const text = props.source.split("\n")[props.line - 1];
  if (text === undefined) return null;
  return {
    line: props.line,
    text,
    caret: props.col === null ? null : caretLine(text, props.col),
  };
});
const details = ref(false);
const output = computed(() => ({
  kind: "error" as const,
  error: props.error,
  when: "run" as const,
}));
const action = `${wordButton} ui:text-small`;
</script>

<template>
  <section
    data-part="run-error"
    aria-label="Error"
    class="ui:flex ui:flex-col ui:gap-1 ui:bg-result ui:ps-(--cell-inset) ui:pe-4 ui:pbs-2 ui:pbe-2.25"
  >
    <div class="ui:flex ui:items-start ui:gap-3 ui:min-block-5.5">
      <!-- as Jupyter and VS Code print it: the error's name and its message on one line -->
      <p
        data-part="error-title"
        class="ui:m-0 ui:flex ui:flex-1 ui:items-baseline ui:gap-1.5 ui:text-code ui:wrap-anywhere ui:min-inline-0"
      >
        <TriangleAlert
          class="ui:shrink-0 ui:self-center ui:text-err ui:block-3.25 ui:inline-3.25"
          aria-hidden="true"
        />
        <span
          ><span data-part="error-name" class="ui:font-mono ui:font-medium ui:text-err">{{
            props.error.name
          }}</span
          ><template v-if="message !== ''"
            >: <span data-part="error-message" class="ui:text-fg">{{ message }}</span></template
          ></span
        >
      </p>
      <button
        type="button"
        :class="action"
        class="ui:shrink-0"
        data-testid="copy-error"
        @click="emit('copyText', errorText(props.error), 'the error')"
      >
        Copy error
      </button>
    </div>
    <SwitchPrompt
      v-if="props.inClient !== null"
      :name="props.inClient.name"
      :index="props.inClient.index"
      :off="props.off"
      @switch="emit('command', 'ui.cell.type', { type: 'client' })"
    />
    <div
      v-if="quoted !== null"
      data-part="error-line"
      class="ui:-ms-2 ui:flex ui:items-start ui:gap-4 ui:self-start ui:bg-err-soft ui:px-2 ui:py-1 ui:font-mono ui:text-small ui:max-inline-[calc(100%+0.5rem)]"
    >
      <span class="ui:shrink-0 ui:font-medium ui:text-err">Line {{ quoted.line }}</span>
      <pre
        data-part="error-excerpt"
        class="ui:m-0 ui:overflow-x-auto ui:font-mono ui:whitespace-pre ui:text-fg ui:min-inline-0">{{ quoted.text }}<template v-if="quoted.caret !== null">{{ "\n" }}<span class="ui:text-err">{{ quoted.caret }}</span></template></pre>
      <button
        v-if="syntax"
        type="button"
        :class="[wordButton, 'ui:font-sans']"
        @click="emit('jump', { cell: props.cell, line: quoted.line, col: props.col ?? 1 })"
      >
        Jump
      </button>
    </div>
    <button
      type="button"
      data-part="error-details"
      :aria-expanded="details"
      class="ui:-ms-1 ui:flex ui:cursor-pointer ui:items-center ui:gap-1.75 ui:self-start ui:rounded-control ui:border ui:border-transparent ui:bg-transparent ui:px-1 ui:text-start ui:text-meta ui:text-muted ui:hover:text-fg ui:focus-visible:border-accent"
      @click="details = !details"
    >
      <component
        :is="details ? ChevronDown : ChevronRight"
        class="ui:shrink-0 ui:block-3 ui:inline-3"
        aria-hidden="true"
      />
      <span class="ui:font-medium ui:text-fg">Details</span>
      <span class="ui:ellipsis">{{ detailsWords(props.error) }}</span>
    </button>
    <div v-if="details" data-part="error-details-body" class="ui:min-inline-0">
      <OutputView :output="output" @jump="(target) => emit('jump', target)" />
    </div>
  </section>
</template>
