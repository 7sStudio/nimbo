<!-- StatusBar: information only, as VS Code's and Jupyter's: on the left the git branch and its sync item (inside a repository; a click on the branch opens Checkout to…), the kernel's state (a click opens the restart menu), its Node, the page's state while it is not attached, the errors and warnings, as VS Code counts them (a click opens the Problems tab, or hides it while it shows) and the routes listening; on the right the keyboard mode, the selected cell, "Folded" while Fold All folds every cell, the caret's line and column while a cell is edited, the cell's language and, last, the panel toggle: it shows or hides the bottom panel (Cmd J, View > Panel) and is pressed while the panel shows, so a hidden panel always has a way back. The status region announces state changes only; the ticking elapsed time is hidden from it. -->
<script setup lang="ts">
import { computed } from "vue";

import Tooltip from "../primitives/tooltip/Tooltip.vue";
import TooltipContent from "../primitives/tooltip/TooltipContent.vue";
import TooltipTrigger from "../primitives/tooltip/TooltipTrigger.vue";
import type { ClusterModel, StatusModel } from "./models";
import StatusBranch from "./StatusBranch.vue";
import { plural } from "./models";
import PanelToggle from "./PanelToggle.vue";
import StatusProblems from "./StatusProblems.vue";

const props = defineProps<{
  model: StatusModel;
  cluster: ClusterModel;
  /** The git branch, `main*` while dirty; null outside a repository. */
  branch?: string | null;
}>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();

const kernelWords: Record<ClusterModel["kernel"], string> = {
  starting: "starting",
  idle: "idle",
  busy: "busy",
  paused: "paused in debugger",
  dead: "exited",
  unknown: "unknown",
  stopped: "stopped",
};
const pageWords: Record<ClusterModel["page"], string> = {
  attached: "attached",
  none: "none attached",
  viewOnly: "view only",
  connecting: "connecting",
  reconnecting: "reconnecting",
  closed: "disconnected",
  waiting: "waiting",
};
/** What the page's state means, in its tooltip. */
const pageMeaning: Record<ClusterModel["page"], string> = {
  attached: "Client cells run in this tab",
  none: "No tab holds the page: client cells wait for one",
  viewOnly: "Another tab holds the page: runs and edits are off here",
  connecting: "Waiting for the daemon to take this tab as the page",
  reconnecting: "The connection to the daemon dropped; reconnecting",
  closed: "The connection to the daemon is closed",
  waiting: "The notebook was closed; waiting for it to open again",
};
/** A kernel to speak of: its Node is shown beside it, not for a closed notebook's or an unknown one. */
const hasKernel = computed(
  () => props.cluster.kernel !== "unknown" && props.cluster.kernel !== "stopped",
);
const pid = computed(() =>
  props.cluster.pid === null ? "" : `, pid ${String(props.cluster.pid)}`,
);
const item =
  "ui:inline-flex ui:cursor-pointer ui:items-center ui:gap-1.25 ui:rounded-control ui:border ui:border-transparent ui:bg-transparent ui:px-1 ui:block-5.5 ui:hover:bg-well ui:hover:text-fg ui:focus-visible:border-accent";
const word = "ui:font-medium ui:text-fg-2";
</script>

<template>
  <footer
    class="ui:flex ui:items-center ui:gap-3 ui:px-2 ui:text-tiny ui:whitespace-nowrap ui:text-muted ui:block-full ui:min-inline-0"
  >
    <StatusBranch
      v-if="props.branch != null"
      :branch="props.branch"
      command="ui.git.checkout"
      :args="{}"
      @command="(id, args) => emit('command', id, args)"
    />
    <div
      role="status"
      aria-label="Kernel and page"
      data-anchor="restart-cluster"
      class="ui:flex ui:items-center ui:gap-2"
    >
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            type="button"
            aria-haspopup="menu"
            :aria-expanded="props.cluster.menuOpen"
            :class="item"
            data-testid="kernel-state"
            :data-state="props.cluster.kernel"
            @click="emit('command', 'ui.restartMenu.open', { from: 'cluster' })"
          >
            Kernel
            <span
              :class="[
                word,
                props.cluster.kernel === 'dead' ? 'ui:text-err' : '',
                props.cluster.kernel === 'busy' ? 'ui:text-hot' : '',
              ]"
              >{{ kernelWords[props.cluster.kernel] }}</span
            >
            <span v-if="props.cluster.exit">{{ props.cluster.exit }}</span>
            <span v-if="props.cluster.elapsed" aria-hidden="true" data-testid="kernel-elapsed">{{
              props.cluster.elapsed
            }}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          Server kernel {{ kernelWords[props.cluster.kernel] }}{{ pid }}
        </TooltipContent>
      </Tooltip>
      <button
        v-if="props.cluster.node !== null && hasKernel"
        type="button"
        :class="item"
        data-testid="kernel-node"
        :title="`Node ${props.model.node}: the kernel.nodePath setting`"
        @click="emit('command', 'ui.settings.open')"
      >
        Node {{ props.cluster.node }}
      </button>
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            v-show="props.cluster.page !== 'attached'"
            type="button"
            aria-haspopup="menu"
            :aria-expanded="props.cluster.menuOpen"
            :class="item"
            data-testid="page-state"
            :data-state="props.cluster.page"
            @click="emit('command', 'ui.restartMenu.open', { from: 'cluster' })"
          >
            Page
            <span :class="[word, props.cluster.page === 'closed' ? 'ui:text-err' : '']">{{
              pageWords[props.cluster.page]
            }}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{{ pageMeaning[props.cluster.page] }}</TooltipContent>
      </Tooltip>
    </div>
    <StatusProblems
      :errors="props.model.errors"
      :warnings="props.model.warnings"
      :shown="props.model.problemsShown"
      :class="item"
      @command="(id, args) => emit('command', id, args)"
    />
    <button
      v-if="props.model.routes > 0"
      type="button"
      :class="item"
      data-testid="status-routes"
      @click="emit('command', 'ui.panel.open', { which: 'routes' })"
    >
      {{ plural(props.model.routes, "route") }}
    </button>
    <span class="ui:flex-1" />
    <span data-testid="mode" :data-mode="props.model.mode" class="ui:font-medium ui:text-fg-2">{{
      props.model.mode === "edit" ? "Edit" : "Command"
    }}</span>
    <template v-if="props.model.cell !== null">
      <span data-testid="where">Cell {{ props.model.cell.number }}/{{ props.model.cell.of }}</span>
      <span v-if="props.model.folded" data-testid="folded">Folded</span>
      <span v-if="props.model.caret !== null" data-testid="caret"
        >Ln {{ props.model.caret.line }}, Col {{ props.model.caret.column }}</span
      >
      <span>{{ props.model.cell.language }}</span>
    </template>
    <PanelToggle
      :open="props.model.bottom"
      :class="item"
      @command="(id: string) => emit('command', id)"
    />
  </footer>
</template>
