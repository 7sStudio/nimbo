<!-- CellCard: one code cell as a block of the notebook's page: its header row (CellHead), the code on pure white (the failing line's number marked in the gutter), the result one tone down (CellResult: a long one stops at seven lines and scrolls in place, its footer saying which lines are in view; one row in its place while the outputs are hidden, O, or pinned to the inspector, P), the header stuck to the top while the page scrolls through an expanded result, the error its run ended with (RunError, which carries the switch of a server cell that needs a client cell's name), then the install prompt of a missing package and its values view; the gap before the next cell is the list's. Square corners; the selected cell sits in a blue frame with a blue bar at its leading edge, and while it is edited the editor takes the blue frame (cell-block in main.css). The numbers of the lines an agent changed that no one reviewed yet are violet, and hovering or focusing them shows the edit's card over the code (AgentEditCard). Folded, the header row alone, its name column saying what is inside. -->
<script setup lang="ts">
import type { MetaPatch } from "./card";
import type { CopyEvent, JumpTarget } from "@jsnb/output-view";
import { ChevronRight } from "@lucide/vue";
import { computed, defineAsyncComponent, ref, watch } from "vue";

import { useStuck } from "../composables/useStuck";
import type { NamedValue } from "../editor/lineValues";
import type { Lines } from "./resultLines";

import { plural } from "../app/models";
import type { Leave } from "../editor/keymap";
import type { CardPage, CardState } from "./card";
import AgentMarks from "./AgentMarks.vue";
import CellEditor from "./CellEditor.vue";
import CellHead from "./CellHead.vue";
import CellResult from "./CellResult.vue";
import type { CellModel } from "./models";

// the prompts a failed run asks for are chunks of their own: most pages never show one (the first-load budget)
const InstallPrompt = defineAsyncComponent(() => import("./InstallPrompt.vue"));
// the values view (N) too: a cell shows it only when asked, and the error block: most runs end well
const CellValues = defineAsyncComponent(() => import("./CellValues.vue"));
const RunError = defineAsyncComponent(() => import("./RunError.vue"));

const props = defineProps<{
  cell: CellModel;
  page: CardPage;
  state: CardState;
  /** The values its lines may show, by name (cells/lineValues.ts). */
  lineValues?: ReadonlyMap<string, NamedValue>;
}>();
const emit = defineEmits<{
  command: [id: string, args?: Record<string, unknown>];
  change: [text: string];
  focus: [];
  blur: [];
  leave: [edge: Leave];
  caret: [line: number, column: number];
  meta: [patch: MetaPatch];
  copy: [event: CopyEvent];
  jump: [target: JumpTarget];
  handled: [];
  copyText: [text: string, what: string];
}>();

const folded = computed(() => props.cell.folded);
/** What O hides: the outputs and the error block. */
const results = computed(() => props.state.outputs.length + (props.state.error === null ? 0 : 1));
const outputsHidden = computed(() => props.cell.meta.outputsHidden === true && results.value > 0);
// Side effect: a folded cell, one whose outputs are hidden or pinned to the inspector, shows no result, so a find, query bar or full-screen
// request for it is answered at once rather than left standing (it would hold the keyboard as an overlay, or fire when
// the cell unfolds).
watch(
  () => (folded.value || outputsHidden.value || props.cell.pinned ? props.state.request : null),
  (request) => {
    if (request !== null) emit("handled");
  },
  { immediate: true },
);
const syntax = computed(() => (props.cell.run.kind === "syntax" ? props.cell.run.place : null));
/** The line of this cell that threw, or where its syntax error is: the gutter marks its number, the block quotes it. */
const failedLine = computed(() => {
  const { run } = props.cell;
  if (run.kind === "syntax") return run.place.line;
  return run.kind === "error" ? run.line : null;
});
/** An expanded result (Expand, meta.outputHeight "fit") keeps the header at the top of the page while the page scrolls
 * through it, with Fold result and Next cell in it and the lines in view after the name. */
const expanded = computed(
  () =>
    props.cell.meta.outputHeight === "fit" &&
    !folded.value &&
    !outputsHidden.value &&
    !props.cell.pinned &&
    props.state.outputs.length > 0,
);
const card = ref<HTMLElement | null>(null);
const stuck = useStuck(card, () => expanded.value);
const lines = ref<Lines | null>(null);
const stuckWords = computed(() => {
  const now = lines.value;
  if (!stuck.value) return null;
  return now === null
    ? "the result"
    : `lines ${String(now.first)} to ${String(now.last)} of ${String(now.total)}`;
});
/** Folded, the name column says what is inside (cells/summary.ts). */
const about = computed(() => (folded.value ? props.cell.inside : props.cell.about));
</script>

<template>
  <article
    ref="card"
    data-part="card"
    :data-type="props.cell.type"
    :data-selected="props.cell.selected ? '' : undefined"
    :data-current="props.cell.current ? '' : undefined"
    :data-folded="folded ? '' : undefined"
    :data-editing="props.cell.editing ? '' : undefined"
    class="ui:group/cell ui:cell-block ui:flex ui:flex-col ui:min-inline-0"
  >
    <CellHead
      :cell="props.cell"
      :about="about"
      :mac="props.page.mac"
      :off="props.page.off"
      :menu="props.state.menu"
      :sticky="expanded"
      :stuck="stuckWords"
      @command="(id, args) => emit('command', id, args)"
    />
    <template v-if="!folded">
      <AgentMarks
        v-slot="{ agentLines }"
        :cell="props.cell"
        :draft="props.state.draft !== undefined"
        :off="props.page.off"
        @command="(id) => emit('command', id)"
      >
        <CellEditor
          :source="props.state.draft ?? props.cell.source"
          language="code"
          :word-wrap="props.page.wordWrap"
          :tab-size="props.page.tabSize"
          :label="`Cell ${props.cell.number} source`"
          :read-only="props.page.off"
          :editing="props.cell.editing"
          :caret="props.state.caret"
          :pending="props.state.draft !== undefined"
          :syntax="syntax"
          :failed-line="failedLine"
          :words="props.page.words"
          :line-values="props.lineValues"
          :agent-lines="agentLines"
          :cell="props.cell.id"
          :diagnostics="props.state.diagnostics"
          @change="(text) => emit('change', text)"
          @focus="emit('focus')"
          @blur="emit('blur')"
          @leave="(edge) => emit('leave', edge)"
          @caret="(line, column) => emit('caret', line, column)"
          @value="(name) => emit('command', 'ui.panel.open', { which: 'variables', name })"
        />
      </AgentMarks>
      <div v-if="outputsHidden" class="ui:flex ui:bg-result ui:py-1.5 ui:ps-(--cell-inset) ui:pe-4">
        <button
          type="button"
          data-part="outputs-hidden"
          class="ui:-ms-1 ui:inline-flex ui:cursor-pointer ui:items-center ui:gap-1.5 ui:rounded-control ui:border ui:border-transparent ui:bg-transparent ui:px-1 ui:text-ui ui:text-muted ui:hover:text-fg ui:focus-visible:border-accent"
          @click="emit('command', 'ui.cell.toggleOutputs')"
        >
          <ChevronRight class="ui:block-3.25 ui:inline-3.25" aria-hidden="true" />
          <span class="ui:visually-hidden">Show the outputs:</span>
          {{ plural(results, "output") }} hidden, O shows them
        </button>
      </div>
      <CellResult
        v-if="!outputsHidden"
        :cell="props.cell"
        :page="props.page"
        :state="props.state"
        @command="(id, args) => emit('command', id, args)"
        @meta="(patch) => emit('meta', patch)"
        @copy="(event) => emit('copy', event)"
        @jump="(target) => emit('jump', target)"
        @handled="emit('handled')"
        @copy-text="(text, what) => emit('copyText', text, what)"
        @lines="(now) => (lines = now)"
      />
      <RunError
        v-if="!outputsHidden && props.state.error !== null"
        :cell="props.cell.id"
        :error="props.state.error"
        :source="props.cell.source"
        :line="failedLine"
        :col="syntax?.col ?? null"
        :in-client="props.state.inClient"
        :off="props.page.off"
        @command="(...command) => emit('command', ...command)"
        @jump="(target) => emit('jump', target)"
        @copy-text="(text, what) => emit('copyText', text, what)"
      />
      <InstallPrompt
        v-if="props.state.missing.length > 0"
        :names="props.state.missing"
        :off="props.page.off"
        @install="(names) => emit('command', 'ui.packages.install', { names })"
      />
      <CellValues
        v-if="props.state.values !== undefined"
        :bindings="props.state.values"
        :defined-by="(by) => props.page.definedBy(props.cell.id, by)"
        :server="props.cell.type === 'server'"
        @close="emit('command', 'ui.cell.toggleValues')"
      />
    </template>
  </article>
</template>
