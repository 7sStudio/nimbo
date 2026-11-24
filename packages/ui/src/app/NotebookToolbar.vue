<!-- NotebookToolbar: the row above the cells, as VS Code's, Cursor's and Jupyter's notebook toolbars: add a server, client or markdown cell; Run All, Run Stale (while some results are out of date), Interrupt, Restart, Clear All Outputs, Fold All and More (the rest of the notebook's actions); on the right Variables, Outline and the kernel (its Node and state; a click opens the restart menu). Labels give way to icons on a narrow notebook. Every control dispatches a command id. -->
<script setup lang="ts">
import type { CellType } from "@jsnb/core";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  CircleSlash,
  Ellipsis,
  FastForward,
  History,
  ListTree,
  LoaderCircle,
  Locate,
  Plus,
  RotateCcw,
  Square,
  Variable,
} from "@lucide/vue";
import { DropdownMenuTrigger } from "reka-ui";
import { computed } from "vue";

import { typeTone } from "../cells/tones";
import TypeIcon from "../cells/TypeIcon.vue";
import { typeName } from "../cells/types";
import { useDispatcher } from "../commands/dispatch";
import { keysFor, keysShown } from "../keyboard/keymap";
import type { MenuItem } from "../overlays/menus";
import MenuItems from "../overlays/MenuItems.vue";
import DropdownMenu from "../primitives/dropdown-menu/DropdownMenu.vue";
import DropdownMenuContent from "../primitives/dropdown-menu/DropdownMenuContent.vue";
import Tooltip from "../primitives/tooltip/Tooltip.vue";
import TooltipContent from "../primitives/tooltip/TooltipContent.vue";
import TooltipTrigger from "../primitives/tooltip/TooltipTrigger.vue";
import type { ClusterModel, TopBarModel } from "./models";
import { plural } from "./models";

const props = defineProps<{
  model: TopBarModel;
  cluster: ClusterModel;
  /** Fold All's fold is on: the button unfolds. */
  folded: boolean;
  /** The running cell, else the one run last in this kernel; null before any run. */
  lastRun: { readonly cell: string; readonly number: number; readonly running: boolean } | null;
  mac: boolean;
}>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();
const dispatcher = useDispatcher();

const run = (id: string, args?: Record<string, unknown>) => {
  emit("command", id, args);
};
const types: readonly CellType[] = ["server", "client", "markdown"];

type Item = Extract<MenuItem, { kind: "item" }>;
const entry = (label: string, command: string, args?: Record<string, unknown>): Item => {
  const keys = keysFor(command, args);
  return { kind: "item", label, command, ...(args ? { args } : {}), ...(keys ? { keys } : {}) };
};
const line: MenuItem = { kind: "separator" };
const more = computed<readonly MenuItem[]>(() => [
  entry("Run Stale Cells", "notebook.run", { select: { stale: true } }),
  entry("Run All Above", "ui.run.above"),
  entry("Run Cell and Below", "ui.run.below"),
  line,
  entry("Restart Kernel and Run All", "ui.kernel.restartRunAll"),
  entry("Restart Kernel and Page", "kernel.restart", { all: true }),
  entry("Restart Page", "realm.restart"),
  line,
  entry("Clear Cell Output", "ui.cell.clearOutput"),
  entry("Clear All Outputs", "notebook.clearOutputs"),
  line,
  entry("Collapse All Sections", "ui.sections.collapseAll"),
  entry("Expand All Sections", "ui.sections.expandAll"),
  line,
  entry("Save", "notebook.save"),
  entry("Export as HTML…", "ui.notebook.exportHtml"),
  entry("Kernel Log", "ui.panel.open", { which: "kernelLog" }),
]);
const available = (item: Item) => dispatcher.available(item.command, item.args);

const kernelWords: Record<ClusterModel["kernel"], string> = {
  starting: "starting",
  idle: "idle",
  busy: "busy",
  paused: "paused",
  dead: "exited",
  unknown: "unknown",
  stopped: "stopped",
};
/** The kernel's dot: filled while it works, as Jupyter's busy circle; red once it exited. */
const dot = computed(() => {
  const { kernel } = props.cluster;
  if (kernel === "busy" || kernel === "starting") return "ui:bg-hot";
  if (kernel === "dead") return "ui:bg-err";
  if (kernel === "idle") return "ui:bg-ok";
  return "ui:bg-muted";
});
const node = computed(() => (props.cluster.node === null ? "Node" : `Node ${props.cluster.node}`));
const kernelLabel = computed(() => `${node.value}, ${kernelWords[props.cluster.kernel]}`);

const icon = "ui:shrink-0 ui:block-3.5 ui:inline-3.5";
const button =
  "ui:inline-flex ui:shrink-0 ui:cursor-pointer ui:items-center ui:gap-1.5 ui:rounded-control ui:border ui:border-transparent ui:bg-transparent ui:px-1.75 ui:font-inherit ui:text-tiny ui:font-medium ui:whitespace-nowrap ui:text-fg-2 ui:block-6.5 ui:hover:bg-well ui:hover:text-fg ui:focus-visible:border-accent ui:disabled:pointer-events-none ui:disabled:opacity-45 ui:aria-expanded:bg-well ui:aria-pressed:bg-well ui:aria-pressed:text-fg ui:data-[state=open]:bg-well";
const label = "ui:@max-[46rem]/bar:visually-hidden";
/** The words of the less used buttons go first as the notebook narrows. */
const minor = "ui:@max-[70rem]/bar:visually-hidden";
const rule = "ui:mx-1 ui:shrink-0 ui:border-s ui:border-well ui:block-4";
</script>

<template>
  <div
    role="toolbar"
    aria-label="Notebook"
    data-testid="notebook-toolbar"
    class="ui:@container/bar ui:flex ui:items-center ui:gap-0.5 ui:overflow-clip ui:border-be ui:border-well ui:bg-side ui:px-1.5 ui:block-9 ui:min-inline-0"
  >
    <Tooltip v-for="each in types" :key="each">
      <TooltipTrigger as-child>
        <button
          type="button"
          :class="button"
          :data-testid="`toolbar-add-${each}`"
          :disabled="props.model.runsOff"
          @click="run('ui.cell.addBelow', { type: each })"
        >
          <Plus class="ui:shrink-0 ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
          <TypeIcon
            :type="each"
            :class="['ui:-ms-1 ui:shrink-0 ui:block-3 ui:inline-3', typeTone[each]]"
          />
          <span :class="label">{{ typeName[each] }}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Add {{ typeName[each] }} Cell
        <template v-if="keysShown('ui.cell.addBelow', props.mac, { type: each })">
          ({{ keysShown("ui.cell.addBelow", props.mac, { type: each }) }})
        </template>
      </TooltipContent>
    </Tooltip>
    <span :class="rule" aria-hidden="true" />
    <button
      type="button"
      :class="button"
      data-testid="toolbar-run-all"
      :title="`Run All${keysShown('notebook.run', props.mac, { select: 'all' }) ? ` (${keysShown('notebook.run', props.mac, { select: 'all' })})` : ''}`"
      :disabled="props.model.runsOff"
      @click="run('notebook.run', { select: 'all' })"
    >
      <FastForward :class="[icon, 'ui:text-hot']" aria-hidden="true" />
      <span :class="label">Run All</span>
    </button>
    <button
      v-if="props.model.staleCount > 0"
      type="button"
      :class="button"
      data-testid="toolbar-run-stale"
      :title="`Run the ${plural(props.model.staleCount, 'stale cell')}`"
      :disabled="props.model.runsOff"
      @click="run('notebook.run', { select: { stale: true } })"
    >
      <History :class="icon" aria-hidden="true" />
      <span :class="label">Run Stale</span>
      <span class="ui:rounded-small ui:bg-well ui:px-1 ui:text-[0.6875rem] ui:leading-4">{{
        props.model.staleCount
      }}</span>
    </button>
    <button
      type="button"
      :class="button"
      data-testid="toolbar-interrupt"
      :title="`Interrupt${keysShown('kernel.interrupt', props.mac) ? ` (${keysShown('kernel.interrupt', props.mac)})` : ''}`"
      :disabled="props.model.runsOff || !props.model.busy"
      @click="run('kernel.interrupt')"
    >
      <Square :class="icon" aria-hidden="true" />
      <span :class="minor">Interrupt</span>
    </button>
    <button
      type="button"
      :class="button"
      data-testid="toolbar-restart"
      :title="`Restart Kernel${keysShown('kernel.restart', props.mac) ? ` (${keysShown('kernel.restart', props.mac)})` : ''}`"
      :disabled="props.model.runsOff"
      @click="run('kernel.restart')"
    >
      <RotateCcw :class="icon" aria-hidden="true" />
      <span :class="label">Restart</span>
    </button>
    <button
      type="button"
      :class="button"
      data-testid="toolbar-clear"
      title="Clear All Outputs"
      :disabled="props.model.runsOff"
      @click="run('notebook.clearOutputs')"
    >
      <CircleSlash :class="icon" aria-hidden="true" />
      <span :class="label">Clear All</span>
    </button>
    <span :class="rule" aria-hidden="true" />
    <button
      type="button"
      :class="button"
      data-testid="toolbar-fold"
      :aria-pressed="props.folded"
      :title="`${props.folded ? 'Unfold' : 'Fold'} All Cells${keysShown('ui.cells.foldAll', props.mac) ? ` (${keysShown('ui.cells.foldAll', props.mac)})` : ''}`"
      @click="run('ui.cells.foldAll')"
    >
      <ChevronsUpDown v-if="props.folded" :class="icon" aria-hidden="true" />
      <ChevronsDownUp v-else :class="icon" aria-hidden="true" />
      <span :class="minor">{{ props.folded ? "Unfold All" : "Fold All" }}</span>
    </button>
    <DropdownMenu>
      <DropdownMenuTrigger
        :class="button"
        aria-label="More Actions"
        title="More Actions"
        data-testid="toolbar-more"
      >
        <Ellipsis :class="icon" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-overlay="menu"
        side="bottom"
        align="start"
        class="ui:min-inline-[15rem]"
      >
        <MenuItems
          :items="more"
          :mac="props.mac"
          overlay="menu"
          :available="available"
          @choose="(item) => run(item.command, item.args)"
        />
      </DropdownMenuContent>
    </DropdownMenu>
    <span class="ui:flex-1" />
    <button
      v-if="props.lastRun !== null"
      type="button"
      :class="[button, 'ui:font-normal ui:text-muted']"
      data-testid="toolbar-last-run"
      :title="`Go to cell ${String(props.lastRun.number)}`"
      @click="run('ui.select', { cell: props.lastRun.cell })"
    >
      <LoaderCircle
        v-if="props.lastRun.running"
        :class="[icon, 'ui:text-hot ui:motion-safe:animate-spin']"
        aria-hidden="true"
      />
      <Locate v-else :class="icon" aria-hidden="true" />
      <span :class="minor">{{ props.lastRun.running ? "Running" : "Last run" }}</span>
      cell {{ props.lastRun.number }}
    </button>
    <button
      type="button"
      :class="button"
      data-testid="toolbar-variables"
      title="Show the kernel's variables"
      @click="run('ui.panel.open', { which: 'variables' })"
    >
      <Variable :class="icon" aria-hidden="true" />
      <span :class="minor">Variables</span>
    </button>
    <button
      type="button"
      :class="button"
      data-testid="toolbar-outline"
      title="Show the outline"
      @click="run('ui.panel.open', { which: 'explorer' })"
    >
      <ListTree :class="icon" aria-hidden="true" />
      <span :class="minor">Outline</span>
    </button>
    <span :class="rule" aria-hidden="true" />
    <button
      type="button"
      :class="[button, 'ui:font-mono ui:font-normal']"
      data-anchor="restart-button"
      data-testid="toolbar-kernel"
      aria-haspopup="menu"
      :aria-expanded="props.model.restartOpen"
      :aria-label="`Kernel: ${kernelLabel}. Open the restart menu`"
      :title="`Kernel: ${kernelLabel}${props.cluster.pid === null ? '' : `, pid ${String(props.cluster.pid)}`}`"
      @click="run('ui.restartMenu.open')"
    >
      <span
        aria-hidden="true"
        :class="['ui:shrink-0 ui:rounded-[1em] ui:block-2 ui:inline-2', dot]"
      />
      {{ node }}
    </button>
  </div>
</template>
