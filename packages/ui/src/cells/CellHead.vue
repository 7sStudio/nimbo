<!-- CellHead: the row every cell block starts with, as Jupyter's and VS Code's notebooks have it: the run control (play; stop while running; a clock while queued), the cell number (in a blue square on a selected cell), where it runs (server, client or markdown with its icon; a click changes the type), its name with a few words about it (CellName: a double click on it edits the title), a spinner with the running time while it runs and nothing otherwise, and its actions (move up, move down, more, and the arrow that folds the cell to this row; a markdown cell has Edit or Render there too). After the name, "Enter switches it to client" on a server cell that failed for a name a client cell defines. A selected cell's name is bold. A right click opens the cell menu. While the page scrolls through an expanded result the row sticks to the top, saying which lines of the result are in view, with Fold result (O) and Next cell (J). -->
<script setup lang="ts">
import { Ban, Check, Clock, LoaderCircle, Play, Square, X } from "@lucide/vue";
import { computed } from "vue";

import { keysShown } from "../keyboard/keymap";
import IconButton from "../primitives/icon-button/IconButton.vue";
import CellActions from "./CellActions.vue";
import CellName from "./CellName.vue";
import { durationText } from "./runWords";
import StuckActions from "./StuckActions.vue";
import type { CellModel } from "./models";
import { typeTone } from "./tones";
import TypeIcon from "./TypeIcon.vue";
import { typeName } from "./types";

const props = defineProps<{
  cell: CellModel;
  /** What the name column adds: the cell's own few words, or what is inside while it is folded. */
  about: string;
  mac: boolean;
  /** Writes are off on this page: the actions that change the notebook are off. */
  off: boolean;
  /** The cell's menu open now, if any: its opener's aria-expanded. */
  menu: "cell" | "type" | null;
  /** The row sticks to the top of the page while the page scrolls through the cell's expanded result. */
  sticky?: boolean;
  /** While it is stuck: the lines of the result in view ("lines 9 to 24 of 24"), said after the name with Fold
   * result and Next cell; null otherwise. */
  stuck?: string | null;
}>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();

const code = computed(() => props.cell.type !== "markdown");
const folded = computed(() => props.cell.folded);
const running = computed(() => props.cell.status === "running");
const runLabel = computed(() => {
  if (running.value) return "Interrupt";
  return props.cell.status === "queued" ? "Queued" : "Run cell";
});
function run(): void {
  emit("command", running.value ? "kernel.interrupt" : "ui.run.inPlace");
}
/** Jupyter's execution prompt: `[*]` while the run waits or goes on, `[7]` once the kernel's 7th run was this cell's,
 * `[ ]` before it ran in this kernel. */
const prompt = computed(() => {
  if (!code.value) return null;
  if (running.value || props.cell.status === "queued") return "*";
  return props.cell.count === null ? " " : String(props.cell.count);
});
/** The prompt's words, for its tooltip and a screen reader. */
const runs = computed(() => {
  if (!code.value) return "";
  if (running.value) return "Running";
  if (props.cell.status === "queued") return "Queued";
  return props.cell.count === null
    ? "Not run in this kernel yet"
    : `Execution ${String(props.cell.count)} of this kernel`;
});
/** The running time counting up while the cell runs. */
const elapsed = computed(() => (props.cell.run.kind === "running" ? props.cell.run.elapsed : null));
/** How the last run ended, as VS Code's cell status: a check or a cross with its time, or an interruption. */
const outcome = computed(() => {
  const { run } = props.cell;
  const time = (ms: number | null) => {
    if (ms === null) return "";
    return ms < 0.05 ? "<0.1 ms" : durationText(ms); // the column's width: never "under 0.1 ms"
  };
  if (run.kind === "ok") {
    // the tooltip says when it ran, as JetBrains' does on hover
    const at = run.at === null ? "" : `, at ${new Date(run.at).toLocaleTimeString()}`;
    return { tone: "ok", time: time(run.ms), words: "Succeeded", at } as const;
  }
  if (run.kind === "error" || run.kind === "syntax")
    return {
      tone: "err",
      time: run.kind === "error" ? time(run.ms) : "",
      words: "Failed",
      at: "",
    } as const;
  if (run.kind === "interrupted")
    return {
      tone: "muted",
      time: run.unstarted ? "" : time(run.ms),
      words: run.unstarted ? "Not run, interrupted" : "Interrupted",
      at: "",
    } as const;
  if (run.kind === "notRun") return { tone: "muted", time: "", words: "Not run", at: "" } as const;
  return null;
});
/** What a key does on this cell now, after its name: null when there is nothing to say. */
const note = computed(() => {
  const { run } = props.cell;
  const keys = keysShown("ui.mode.edit", props.mac);
  return run.kind === "error" && run.switchable === true && !folded.value && keys !== undefined
    ? { hook: "switch-hint", words: `${keys} switches it to client` }
    : null;
});
/** A markdown cell's own action: Edit while it is rendered, Render while it is edited. */
const markdown = computed(() => {
  if (code.value) return undefined;
  return props.cell.editing ? "editing" : "rendered";
});
/** The actions' commands, as they were emitted: no argument stays no argument. */
const forward = (...command: [id: string, args?: Record<string, unknown>]) => {
  emit("command", ...command);
};
const small = "ui:block-5 ui:inline-5";
/** A click on the header row folds or unfolds the cell, as a notebook's cell header does; its buttons keep their own
 * click, and the cell number only selects the cell, as Jupyter's prompt area does. */
function fold(event: MouseEvent): void {
  if (props.off) return; // a view-only tab writes nothing: the click only selects the cell
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('button, a, input, [data-part="number"], [data-part="name"]') != null) return;
  emit("command", "ui.cell.toggleCollapse");
}
</script>

<template>
  <div
    data-part="head"
    :data-selected="props.cell.selected ? '' : undefined"
    :data-sticky="props.sticky ? '' : undefined"
    :data-stuck="props.stuck ? '' : undefined"
    class="ui:group/head ui:grid ui:cursor-pointer ui:grid-cols-(--cell-columns) ui:items-center ui:bg-head ui:text-fg-2 ui:block-7.5 ui:data-sticky:sticky ui:data-sticky:inset-bs-0 ui:data-sticky:z-(--z-toolbar) ui:data-stuck:shadow-(--shadow-stick)"
    @click="fold"
    @contextmenu.prevent="
      (event: MouseEvent) =>
        emit('command', 'ui.cellMenu.open', { x: event.clientX, y: event.clientY })
    "
  >
    <span class="ui:flex ui:justify-center ui:ps-1.5">
      <IconButton
        v-if="code"
        :label="runLabel"
        :keys="keysShown(running ? 'kernel.interrupt' : 'ui.run.inPlace', props.mac)"
        side="right"
        :disabled="props.cell.runOff || props.cell.status === 'queued'"
        data-testid="run-cell"
        :class="[
          small,
          running || props.cell.selected ? 'ui:text-fill ui:hover:text-fill' : 'ui:text-faint',
        ]"
        @click="run"
      >
        <Square v-if="running" class="ui:block-2.5 ui:inline-2.5" aria-hidden="true" />
        <Clock
          v-else-if="props.cell.status === 'queued'"
          class="ui:block-3 ui:inline-3"
          aria-hidden="true"
        />
        <Play v-else class="ui:fill-current ui:block-2.5 ui:inline-2.5" aria-hidden="true" />
      </IconButton>
    </span>
    <span
      class="ui:text-end ui:font-mono ui:text-name ui:font-medium"
      data-part="number"
      :class="props.off ? '' : 'ui:cursor-grab'"
    >
      <span
        class="ui:-me-1.25 ui:inline-block ui:rounded-control ui:px-1.25 ui:leading-5 ui:group-data-selected/head:bg-focus ui:group-data-selected/head:text-focus-fg"
        >{{ props.cell.number }}</span
      >
      <span class="ui:visually-hidden" data-testid="exec-count">{{ runs }}</span>
    </span>
    <span class="ui:flex ui:ps-3">
      <button
        type="button"
        :aria-label="`Runs in: ${typeName[props.cell.type].toLowerCase()}. Change type`"
        :title="`${typeName[props.cell.type]} cell, click to change its type`"
        aria-haspopup="menu"
        :aria-expanded="props.menu === 'type'"
        :disabled="props.off"
        data-testid="type-chip"
        class="ui:inline-flex ui:cursor-pointer ui:items-center ui:gap-1.75 ui:rounded-control ui:border ui:border-transparent ui:bg-transparent ui:px-1 ui:text-fg-2 ui:block-5.5 ui:hover:bg-well ui:focus-visible:border-accent ui:disabled:cursor-default"
        @click="emit('command', 'ui.typeMenu.open')"
      >
        <TypeIcon
          :type="props.cell.type"
          :class="['ui:block-3.25 ui:inline-3.25', typeTone[props.cell.type]]"
        />
        {{ typeName[props.cell.type].toLowerCase() }}
      </button>
    </span>
    <span
      class="ui:@container/name ui:flex ui:items-baseline ui:gap-3.5 ui:pe-4 ui:whitespace-nowrap ui:min-inline-0"
    >
      <CellName :cell="props.cell" :code="code" :off="props.off" @command="forward" />
      <StuckActions v-if="props.stuck" :lines="props.stuck" :mac="props.mac" @command="forward" />
      <span
        v-else-if="props.about !== ''"
        data-part="about"
        class="ui:flex-[1_3_0%] ui:ellipsis ui:text-[0.71875rem] ui:text-muted ui:min-inline-0 ui:group-data-selected/head:text-fg-2"
        >{{ props.about }}</span
      >
      <span
        v-if="note !== null"
        :data-testid="note.hook"
        class="ui:shrink-0 ui:text-[0.71875rem] ui:text-muted ui:group-data-selected/head:text-fg-2"
        >{{ note.words }}</span
      >
    </span>
    <span
      data-testid="run-fact"
      :data-kind="props.cell.run.kind"
      class="ui:flex ui:items-center ui:justify-end ui:gap-1.5 ui:overflow-clip ui:pe-1.5 ui:font-mono ui:text-[0.71875rem] ui:whitespace-nowrap ui:text-hot"
    >
      <template v-if="running">
        <LoaderCircle
          class="ui:shrink-0 ui:block-3.25 ui:inline-3.25 ui:motion-safe:animate-spin"
          aria-label="running"
        />
        <span v-if="elapsed !== null" data-testid="cell-elapsed">{{ elapsed }}</span>
      </template>
      <span
        v-else-if="props.cell.status === 'queued'"
        class="ui:font-sans ui:text-muted"
        data-testid="cell-queued"
        >queued</span
      >
      <span
        v-else-if="props.cell.run.kind === 'saved'"
        data-testid="saved-output"
        class="ui:font-sans ui:text-muted"
        :title="`Saved output from ${new Date(props.cell.run.at).toLocaleString()}; not run in this session`"
        >Saved</span
      >
      <span
        v-else-if="outcome !== null"
        data-testid="run-outcome"
        :data-tone="outcome.tone"
        :title="`${outcome.time === '' ? outcome.words : `${outcome.words} in ${outcome.time}`}${outcome.at}`"
        class="ui:flex ui:items-center ui:gap-1 ui:text-muted"
      >
        <Check
          v-if="outcome.tone === 'ok'"
          class="ui:shrink-0 ui:text-ok ui:block-3.5 ui:inline-3.5"
          :aria-label="outcome.words"
        />
        <X
          v-else-if="outcome.tone === 'err'"
          class="ui:shrink-0 ui:text-err ui:block-3.5 ui:inline-3.5"
          :aria-label="outcome.words"
        />
        <Ban v-else class="ui:shrink-0 ui:block-3 ui:inline-3" :aria-label="outcome.words" />
        <span v-if="outcome.time !== ''">{{ outcome.time }}</span>
      </span>
      <span
        v-if="prompt !== null"
        data-testid="exec-prompt"
        :title="runs"
        :class="[
          'ui:shrink-0 ui:text-end ui:text-muted ui:min-inline-[3.5ch]',
          prompt === '*' ? 'ui:text-hot' : '',
        ]"
        >[{{ prompt }}]</span
      >
    </span>
    <CellActions
      :mac="props.mac"
      :off="props.off"
      :menu-open="props.menu === 'cell'"
      :folded="markdown === 'editing' ? null : folded"
      :markdown="markdown"
      @command="forward"
    />
  </div>
</template>
