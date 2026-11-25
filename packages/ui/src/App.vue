<!-- The notebook page: the .jsnb-ui root every component of ours renders under, the workbench with its top bar, banners, icon bar, side panel, notebook, bottom panel, inspector, status bar and toasts fed from the stores, the theme from ui.theme on <html>, the keyboard map and the live line a screen reader hears. The overlays mount beside it while open. -->
<script setup lang="ts">
import { syntaxThemeOf } from "./theme/syntaxTheme";
import { computed, defineAsyncComponent, watchEffect } from "vue";

import Banners from "./app/Banners.vue";
import NotebookToolbar from "./app/NotebookToolbar.vue";
import StatusBar from "./app/StatusBar.vue";
import Toasts from "./app/Toasts.vue";
import TopBar from "./app/TopBar.vue";
import Workbench from "./app/Workbench.vue";
import { notebookMenus, themeOf } from "./app/appMenus";
import { useAnnouncer } from "./app/useAnnouncer";
import { usePageTheme } from "./app/usePageTheme";
import { runsOff, useShell } from "./app/useShell";
import CellList from "./cells/CellList.vue";
import { useDispatcher } from "./commands/dispatch";
import { isMac } from "./keyboard/modes";
import { useShortcuts } from "./keyboard/useShortcuts";
import { useKeybindings } from "./app/useKeybindings";
import Overlays from "./overlays/Overlays.vue";
import IconBar from "./panel/IconBar.vue";
import TooltipProvider from "./primitives/tooltip/TooltipProvider.vue";
import { useGitStore } from "./store/git";
import { useRunCountStore } from "./store/runCounts";
import { useNotebookStore } from "./store/notebook";
import { useSettingsStore } from "./store/settings";
import { useUiStore } from "./store/ui";

// The side panel, the inspector (and its icons when hidden) and the bottom panel are chunks of their own, loaded when
// they first show: the first load carries the
// notebook alone (the page bundle's budget, 08-code-standards §10).
const SidePanel = defineAsyncComponent(() => import("./panel/SidePanel.vue"));
const Inspector = defineAsyncComponent(() => import("./panel/Inspector.vue"));
const BottomPanel = defineAsyncComponent(() => import("./panel/BottomPanel.vue"));
const SettingsPage = defineAsyncComponent(() => import("./panel/SettingsPage.vue"));
const KeybindingsPage = defineAsyncComponent(() => import("./panel/KeybindingsPage.vue"));
const InspectorRail = defineAsyncComponent(() => import("./panel/InspectorRail.vue"));
const DiffPage = defineAsyncComponent(() => import("./diff/DiffPage.vue"));
const DebugToolbar = defineAsyncComponent(() => import("./app/DebugToolbar.vue"));
/** VS Code's debug toolbar shows while a session runs: here while the kernel is paused, or runs a cell under the
 * debugger. */
const debugging = computed(() => {
  const state = notebook.mirror.notebook?.debug?.state ?? "off";
  return state === "paused" || (state === "running" && notebook.runningCell !== null);
});

const dispatcher = useDispatcher();
const ui = useUiStore();
const notebook = useNotebookStore();
const { topBar, cluster, banners, status } = useShell();
// Side effect: the window's title names the notebook, with VS Code's dot while changes are not on disk
watchEffect(() => {
  const file = topBar.value.file;
  document.title = `${topBar.value.save === "saved" ? "" : "\u25CF "}${file === "" ? "nimbo" : `${file} \u2014 nimbo`}`;
});
const announced = useAnnouncer();
const mac = isMac(navigator.userAgent);
useKeybindings();
useShortcuts(dispatcher);
const settings = useSettingsStore();
const theme = computed(() => themeOf(settings.valueOf("ui.theme")));
const menus = computed(() =>
  notebookMenus(theme.value, syntaxThemeOf(settings.valueOf("editor.syntaxTheme"))),
);
usePageTheme(document.documentElement, globalThis.localStorage);

const run = (id: string, args?: Record<string, unknown>) => void dispatcher.dispatch(id, args);
const git = useGitStore();
const counts = useRunCountStore();
/** The toolbar's Go to Cell, as JetBrains' notebook toolbar has it: the running cell, else the last one run. */
const lastRun = computed(() => {
  const cells = notebook.cellsInOrder;
  const running = cells.find((cell) => cell.status === "running");
  if (running !== undefined) return { cell: running.id, number: running.index + 1, running: true };
  let last: { cell: string; number: number; running: boolean; count: number } | null = null;
  for (const cell of cells) {
    const count = counts.countOf(cell.id);
    if (count !== null && (last === null || count > last.count))
      last = { cell: cell.id, number: cell.index + 1, running: false, count };
  }
  return last;
});
/** The changed files on the Source Control icon; null hides it (no repository, or git.enabled off). */
const scmChanges = computed(() =>
  !git.loaded || settings.valueOf("git.enabled") === false ? null : git.count,
);
/** The status bar's branch, `main*` while the tree is dirty, as VS Code shows it; null outside a repository. */
const scmBranch = computed(() => {
  if (scmChanges.value === null || git.repo === null) return null;
  const name = git.repo.branch.name ?? git.repo.branch.oid?.slice(0, 7) ?? "";
  return `${name}${git.dirty ? "*" : ""}`;
});
const jumps = computed(() =>
  notebook.cellsInOrder.map((cell, at) => ({
    id: cell.id,
    number: at + 1,
    selected: cell.id === ui.selected,
  })),
);
/** How many names the server cells export, for the hidden inspector's Bridge icon. */
const exported = computed(
  () =>
    new Set(
      notebook.cellsInOrder.flatMap((cell) =>
        cell.type === "server" ? (notebook.mirror.graph.get(cell.id)?.exports ?? []) : [],
      ),
    ).size,
);
/** "cell 5" while a result is pinned to the inspector. */
const pinnedFrom = computed(() => {
  const at = notebook.cellsInOrder.findIndex((cell) => cell.id === ui.pinned);
  return at < 0 ? null : `cell ${String(at + 1)}`;
});
</script>

<template>
  <div class="jsnb-ui">
    <TooltipProvider>
      <Workbench>
        <template #top
          ><TopBar :model="topBar" :menus="menus" :mac="mac" @command="run"
        /></template>
        <template #banners><Banners :banners="banners" @command="run" /></template>
        <template #rail>
          <IconBar
            :open="ui.layout.side.open ? ui.layout.side.view : null"
            :last="ui.layout.side.view"
            :agent-edits="notebook.agentEditCount"
            :changes="scmChanges"
            :cells="jumps"
            :theme="theme"
            :mac="mac"
            @command="run"
          />
        </template>
        <template #side><SidePanel /></template>
        <template v-if="ui.page === null && notebook.mirror.notebook !== null" #toolbar>
          <NotebookToolbar
            :model="topBar"
            :cluster="cluster"
            :folded="ui.foldAll"
            :last-run="lastRun"
            :mac="mac"
            @command="run"
          />
        </template>
        <template #page>
          <!-- Settings takes the main area, as VS Code's editor tab; closing it shows the cells again -->
          <SettingsPage v-if="ui.page === 'settings'" :off="runsOff(notebook)" @command="run" />
          <KeybindingsPage
            v-else-if="ui.page === 'keybindings'"
            :off="runsOff(notebook)"
            @command="run"
          />
          <DiffPage v-else-if="ui.page === 'diff'" @command="run" />
          <template v-else-if="notebook.mirror.notebook !== null">
            <div
              v-if="debugging"
              class="ui:pointer-events-none ui:sticky ui:inset-bs-1 ui:z-(--z-toolbar) ui:flex ui:items-start ui:justify-center ui:block-0"
            >
              <DebugToolbar />
            </div>
            <CellList />
          </template>
        </template>
        <template #bottom><BottomPanel /></template>
        <template #inspector><Inspector /></template>
        <template #inspector-rail>
          <InspectorRail
            :exports="exported"
            :routes="notebook.mirror.routes.length"
            :pinned="pinnedFrom"
            :mac="mac"
            @command="run"
          />
        </template>
        <template #footer>
          <StatusBar :model="status" :cluster="cluster" :branch="scmBranch" @command="run" />
        </template>
      </Workbench>
      <Overlays />
      <Toasts
        :toasts="ui.toasts"
        @command="run"
        @dismiss="ui.dismiss"
        @pause="ui.pause"
        @resume="ui.resume"
      />
    </TooltipProvider>
    <p aria-live="polite" class="ui:visually-hidden" data-testid="announcer">{{ announced }}</p>
  </div>
</template>
